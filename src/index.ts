/**
 * dsh-llm-quotes host half.
 *
 * Mounts the LLMRates service, local settings/associations store, same-origin
 * JSON routes (including the watchlist API), and a conservative periodic
 * refresh so the local dataset snapshot stays reasonably fresh (default
 * 60 minutes). After each actual dataset refresh, active watchlist records
 * get a new price snapshot, so their history grows as prices change.
 * @module dsh-llm-quotes
 */

import { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the webServer Context merge (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
import { LlmRatesService } from './llmrates.ts'
import { makeLlmQuotesRoutes, LLM_QUOTES_API_PREFIX } from './server/routes.ts'
import { LlmQuotesStore } from './server/store.ts'
import { snapshotActiveRecords } from './server/watchlist.ts'

export { LlmRatesService } from './llmrates.ts'
export { LlmQuotesStore } from './server/store.ts'
export { makeLlmQuotesRoutes, LLM_QUOTES_API_PREFIX } from './server/routes.ts'
export { loadStore, configFilePath, dataFilePath } from './config.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'llm-quotes'

/** Required service: the harness web server the routes register on. */
export const inject = ['webServer']

/** Plugin configuration. */
export interface LlmQuotesConfig {
  /** Master switch for the host service (default true). */
  enabled?: boolean
}

/** Register the service, routes, and periodic refresh. */
export function apply(ctx: Context, config: LlmQuotesConfig = {}): void {
  const service = new LlmRatesService()
  const store = new LlmQuotesStore()

  ctx.effect(
    () => {
      const routes = makeLlmQuotesRoutes(service, store)
      const disposers = routes.map((route) => ctx.webServer.register(route))
      return () => {
        for (const dispose of disposers) dispose()
      }
    },
    'llm-quotes: routes',
  )

  // Keep the local dataset fresh: at most one background sync per calendar
  // day — fired shortly after startup (the first time dsh opens that day),
  // with a cheap hourly presence check that only compares local timestamps
  // and refetches when the day actually changed (covers processes that stay
  // running across midnight). No network happens unless a sync is due.
  // After an actual refresh, active watchlist records get a price snapshot
  // (deduped, so history only grows when prices change).
  ctx.effect(
    () => {
      if (config.enabled === false) return () => {}
      const tick = async (): Promise<void> => {
        try {
          if (service.needsRefresh()) {
            const snapshot = await service.ensureLoaded(true)
            await snapshotActiveRecords(snapshot.models)
          }
        } catch {
          // Ignore background refresh errors; the next check or an explicit
          // user refresh will retry. The last good snapshot stays on disk.
        }
      }
      // Fire once shortly after startup so a fresh install gets data.
      const first = setTimeout(() => { void tick() }, 5_000)
      const timer = setInterval(() => { void tick() }, 60 * 60_000)
      return () => {
        clearTimeout(first)
        clearInterval(timer)
      }
    },
    'llm-quotes: daily background refresh',
  )
}

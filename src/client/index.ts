/**
 * dsh-llm-quotes browser half — registers the per-provider quote blocks in
 * the Settings → Models page (a `settings.action` occupant that injects one
 * quote block under every provider card). The browser only talks to
 * same-origin `/api/llm-quotes` endpoints.
 *
 * Configured models are implicitly priced; an explicit watchlist (star
 * toggles in the quote tables and the details popup) is persisted locally
 * (localStorage) and mirrored to the host JSONL store — follow upserts an
 * `active` record, unfollow pauses it so its price history survives. The
 * standalone prices panel is not wired to any seat yet (kept as
 * `LlmQuotesPanel` for its later Settings migration).
 * @module dsh-llm-quotes/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { Translate, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings slot contract (settings.action) into SlotMap.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the connection service merge (ctx.connection) and the
// host RPC wire types for the harness Settings → Models data.
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ModelProviderGroup, RpcResponse } from '@deepseek-ai/dsh-client-connection/client'
import type {
  HarnessProviderRef,
  ManualAssociation,
  MetaResponse,
  ModelsResponse,
  ModelInfo,
  OverviewResponse,
  PriceChangeResult,
  PriceInfo,
  PriceSnapshot,
  ProviderInfo,
  SettingsResponse,
  WatchlistRecord,
  WatchlistStatus,
} from '../types.ts'
import { en, zh, NS } from './locales.ts'
import { SettingsModelsQuotes, type SettingsModelsQuotesProps } from './SettingsModelsQuotes.tsx'
import {
  ComposerModelSelect,
  resolveSessionDirectory,
  isSubagentSession,
  type ModelSelection,
} from './ComposerModelSelect.tsx'

export { SettingsModelsQuotes } from './SettingsModelsQuotes.tsx'
export type { SettingsModelsQuotesProps } from './SettingsModelsQuotes.tsx'
export { ComposerModelSelect, resolveSessionDirectory, isSubagentSession } from './ComposerModelSelect.tsx'
export type { ModelSelection, ModelDirectoryFace, ModelDirectoryState } from './ComposerModelSelect.tsx'
export { priceSignalOf, type PriceSignal, type PriceSignalField } from './signals.ts'
export { useQuotesData, type QuotesDataState } from './useQuotesData.ts'
export * from './matching.ts'
export { findModelsSection, providerCardsOf, cardDisplayName } from './modelsSectionDom.ts'
export type { WatchlistStatus, PriceSnapshot, WatchlistRecord, PriceChangeResult } from '../types.ts'

/** Client-side API surface for the Settings → Models quote blocks. */
export interface LlmQuotesApi {
  overview(): Promise<OverviewResponse>
  models(params: { q?: string; provider?: string; modality?: string; page?: number; pageSize?: number }): Promise<ModelsResponse>
  providers(): Promise<ProviderInfo[]>
  modalities(): Promise<string[]>
  /** Dataset metadata (source update date vs local fetch time). */
  meta(): Promise<MetaResponse>
  refresh(): Promise<OverviewResponse>
  getSettings(): Promise<SettingsResponse>
  updateSettings(partial: { refreshMinutes?: number; compareLimit?: number }): Promise<SettingsResponse>
  /** Full model lists per quotes-provider slug (quote-block lookup). */
  providerModels(slugs: string[]): Promise<Record<string, readonly ModelInfo[]>>
  /** Providers/models configured in the harness Settings → Models page. */
  harnessConfigured(): Promise<HarnessProviderRef[]>
  associations(): Promise<readonly ManualAssociation[]>
  setAssociation(association: ManualAssociation): Promise<readonly ManualAssociation[]>
  removeAssociation(providerRoute: string, modelId: string): Promise<readonly ManualAssociation[]>
  /** Watchlist: get all watched models. */
  getWatchlist(): Promise<readonly WatchlistRecord[]>
  /** Watchlist: add/update a watched model. */
  upsertWatchlist(model: ModelInfo, providerSlug: string, status?: WatchlistStatus): Promise<WatchlistRecord>
  /** Watchlist: permanently delete a record (unfollow keeps it as `paused`). */
  removeWatchlist(key: string): Promise<boolean>
  /** Watchlist: update status of a watched model. */
  updateWatchlistStatus(key: string, status: WatchlistStatus): Promise<WatchlistRecord>
  /** Watchlist: append a price snapshot. */
  appendPriceSnapshot(key: string, price: PriceInfo): Promise<WatchlistRecord>
  /** Watchlist: get price change between two time points. */
  getPriceChange(key: string, from?: string, to?: string): Promise<PriceChangeResult>
  /** Watchlist: batch price changes for many keys (absent keys omitted). */
  priceChanges(keys: string[]): Promise<Record<string, PriceChangeResult | null>>
}

/**
 * Status values for watched models:
 * - `active`: currently watching, prices will be tracked
 * - `paused`: unfollowed but history preserved (the star is off)
 * - `archived`: model no longer relevant, history kept
 */
// Type re-exports from ../types.ts (WatchlistStatus, PriceSnapshot,
// WatchlistRecord, PriceChangeResult) keep the API surface stable.

/** Injected props for the Settings → Models quote blocks. */
export interface LlmQuotesInjected {
  t: TranslateNS<typeof NS>
  /** Translate bound to the settings.models namespace (Models section title). */
  tModels: Translate
  api: LlmQuotesApi
}

/** Required services: slots for the settings header seat, locale for copy,
 * and the host RPC connection for the harness Settings → Models snapshot. */
export const inject = ['slots', 'locale', 'connection']

/** Small same-origin fetch helper. */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    throw new Error(`llm-quotes ${path} failed: ${response.status}`)
  }
  return (await response.json()) as T
}

/** Unwrap one host RPC response; throws with the RPC error on failure. */
function rpcValue<T>(response: RpcResponse<T>): T {
  const result = response.result
  if (result.ok) return result.value
  throw new Error(`llm-quotes rpc ${result.error.code}: ${result.error.message}`)
}

/** Walk a settings path (`['providers', 'xai']`) through a namespace value. */
function getPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/**
 * Normalize the harness Settings → Models snapshot into per-provider model
 * refs. A provider counts as configured when its settings profile exists;
 * its quoteable ids come from the profile's explicit `models`/`modelOverrides`
 * or, when the route serves its whole catalog, from the live model directory.
 */
function modelIdsOf(
  profile: unknown,
  catalog: readonly ModelProviderGroup[],
  route: string,
): { explicit: boolean; refs: { id: string; name?: string }[] } {
  const refs: { id: string; name?: string }[] = []
  const seen = new Set<string>()
  if (typeof profile === 'object' && profile !== null) {
    const record = profile as Record<string, unknown>
    if (Array.isArray(record.models)) {
      for (const entry of record.models) {
        if (typeof entry !== 'object' || entry === null) continue
        const id = (entry as Record<string, unknown>).id
        if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
          seen.add(id)
          const name = (entry as Record<string, unknown>).name
          refs.push({ id, name: typeof name === 'string' ? name : undefined })
        }
      }
    }
    if (typeof record.modelOverrides === 'object' && record.modelOverrides !== null) {
      for (const key of Object.keys(record.modelOverrides as Record<string, unknown>)) {
        if (!seen.has(key)) {
          seen.add(key)
          refs.push({ id: key })
        }
      }
    }
  }
  if (refs.length > 0) return { explicit: true, refs }
  const group = catalog.find((item) => item.id === route)
  return {
    explicit: false,
    refs: (group?.models ?? []).map((model) => ({ id: model.id, name: model.name })),
  }
}

async function fetchHarnessConfigured(connection: ConnectionHandle): Promise<HarnessProviderRef[]> {
  const [providersResponse, settingsResponse, catalogResponse] = await Promise.all([
    connection.api.llm.providers({}),
    connection.api.settings.describe({}),
    connection.api.llm.models({}),
  ])
  const providers = rpcValue(providersResponse).providers
  const namespaces = rpcValue(settingsResponse).namespaces
  const catalog = rpcValue(catalogResponse).groups
  const nsByKey = new Map(namespaces.map((ns) => [ns.ns, ns]))

  const out: HarnessProviderRef[] = []
  for (const view of providers) {
    const ns = nsByKey.get(view.settingsNs)
    const profile = getPath(ns?.value, view.settingsPath)
    if (profile === undefined) continue // Provider not configured.
    const { explicit, refs } = modelIdsOf(profile, catalog, view.provider)
    if (refs.length === 0) continue // Nothing to quote.
    out.push({
      route: view.provider,
      displayName: view.displayName,
      active: view.active,
      models: refs.map((ref) => ({ id: ref.id, name: ref.name ?? null, explicit })),
    })
  }
  return out
}

function makeApi(connection: ConnectionHandle | undefined): LlmQuotesApi {
  return {
    overview: () => apiFetch<OverviewResponse>('/api/llm-quotes/overview'),
    models: (params) => {
      const search = new URLSearchParams()
      if (params.q) search.set('q', params.q)
      if (params.provider) search.set('provider', params.provider)
      if (params.modality) search.set('modality', params.modality)
      if (params.page !== undefined) search.set('page', String(params.page))
      if (params.pageSize !== undefined) search.set('pageSize', String(params.pageSize))
      const qs = search.toString()
      return apiFetch<ModelsResponse>(`/api/llm-quotes/models${qs ? `?${qs}` : ''}`)
    },
    providers: () => apiFetch<ProviderInfo[]>('/api/llm-quotes/providers'),
    meta: () => apiFetch<MetaResponse>('/api/llm-quotes/meta'),
    modalities: () => apiFetch<string[]>('/api/llm-quotes/modalities'),
    refresh: () => apiFetch<OverviewResponse>('/api/llm-quotes/refresh', { method: 'POST' }),
    getSettings: () => apiFetch<SettingsResponse>('/api/llm-quotes/settings'),
    updateSettings: (partial) => apiFetch<SettingsResponse>('/api/llm-quotes/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(partial),
    }),
    providerModels: (slugs) => apiFetch<Record<string, readonly ModelInfo[]>>(
      `/api/llm-quotes/provider-models?providers=${encodeURIComponent(slugs.join(','))}`,
    ),
    harnessConfigured: () => {
      if (connection === undefined) {
        return Promise.reject(new Error('connection service unavailable'))
      }
      return fetchHarnessConfigured(connection)
    },
    associations: () => apiFetch<{ associations: readonly ManualAssociation[] }>('/api/llm-quotes/associations')
      .then((body) => body.associations),
    setAssociation: (association) => apiFetch<{ associations: readonly ManualAssociation[] }>(
      '/api/llm-quotes/associations',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(association),
      },
    ).then((body) => body.associations),
    removeAssociation: (providerRoute, modelId) => apiFetch<{ associations: readonly ManualAssociation[] }>(
      '/api/llm-quotes/associations',
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ providerRoute, modelId }),
      },
    ).then((body) => body.associations),
    // Watchlist endpoints
    getWatchlist: () => apiFetch<{ records: readonly WatchlistRecord[] }>('/api/llm-quotes/watchlist')
      .then((body) => body.records),
    upsertWatchlist: (model, providerSlug, status) => apiFetch<{ record: WatchlistRecord }>(
      '/api/llm-quotes/watchlist',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, providerSlug, status }),
      },
    ).then((body) => body.record),
    removeWatchlist: (key) => apiFetch<{ removed: boolean }>(
      '/api/llm-quotes/watchlist',
      {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      },
    ).then((body) => body.removed),
    updateWatchlistStatus: (key, status) => apiFetch<{ record: WatchlistRecord }>(
      '/api/llm-quotes/watchlist',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, status }),
      },
    ).then((body) => body.record),
    appendPriceSnapshot: (key, price) => apiFetch<{ record: WatchlistRecord }>(
      '/api/llm-quotes/watchlist',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, price }),
      },
    ).then((body) => body.record),
    getPriceChange: (key, from, to) => {
      const params = new URLSearchParams({ key })
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      return apiFetch<PriceChangeResult>(`/api/llm-quotes/watchlist/price-change?${params.toString()}`)
    },
    priceChanges: (keys) => {
      if (keys.length === 0) return Promise.resolve({})
      const params = new URLSearchParams({ keys: keys.join(',') })
      return apiFetch<{ changes: Record<string, PriceChangeResult | null> }>(
        `/api/llm-quotes/watchlist/price-changes?${params.toString()}`,
      ).then((body) => body.changes)
    },
  }
}

/**
 * Register the Settings → Models quote-block seat: a `settings.action`
 * occupant that renders nothing in the header and injects quote blocks under
 * every provider card of the Models section. Also takes the composer model
 * seat (`conversation.input.model`) with a model selector that annotates
 * watched models with watchlist price-change signal dots.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-llm-quotes: dictionaries')

  const injected = (): LlmQuotesInjected => ({
    t: ctx.locale.bind(NS),
    tModels: ctx.locale.bind('settings.models'),
    api: makeApi(ctx.get('connection')),
  })

  ctx.slots.inject('settings.action', () => ctx.slots.register(
    {
      name: 'settings.action',
      id: 'llm-quotes',
      order: 100,
      inject: injected,
    },
    SettingsModelsQuotes,
  ))

  // Single-seat shadowing: the shipped ModelSelect registers at priority 0
  // and "lowest renders", so this occupant must register BELOW it to win.
  ctx.slots.inject('conversation.input.model', () => ctx.slots.register(
    {
      name: 'conversation.input.model',
      priority: -1,
      inject: (sessionId: string) => {
        const api = makeApi(ctx.get('connection'))
        const directory = resolveSessionDirectory(ctx, sessionId)
        const available = !isSubagentSession(ctx, sessionId)
        return {
          available,
          directory,
          load: () => {
            if (available) directory.load().catch(() => {})
          },
          select: (selection: ModelSelection) =>
            available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false),
          api,
          t: ctx.locale.bind(NS),
        }
      },
    },
    ComposerModelSelect,
  ))
}

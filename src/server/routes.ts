/**
 * Same-origin JSON API for dsh-llm-quotes.
 *
 * The browser half only talks to these endpoints; LLMRates.ai is never
 * called directly from the page. The watchlist endpoints back the star
 * toggles in the quote blocks: follow upserts a record (status `active`),
 * unfollow pauses it (history preserved), and PATCH carries status/price
 * snapshot updates.
 * @module dsh-llm-quotes/server/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { overviewFromSnapshot, type LlmRatesService } from '../llmrates.ts'
import type { ManualAssociation, ModelInfo, PriceInfo, WatchlistStatus } from '../types.ts'
import { LlmQuotesStore } from './store.ts'
import * as watchlist from './watchlist.ts'

/** Browser-facing API prefix. */
export const LLM_QUOTES_API_PREFIX = '/api/llm-quotes'

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function requireMethod(req: IncomingMessage, res: ServerResponse, method: string): boolean {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 64 * 1024) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw) as unknown)
      } catch {
        reject(new Error('bad-json'))
      }
    })
    req.on('error', reject)
  })
}

/** Parse a watchlist status; null when present but invalid. */
function parseStatus(value: unknown, fallback: WatchlistStatus | null): WatchlistStatus | null {
  if (value === undefined) return fallback
  return value === 'active' || value === 'paused' || value === 'archived'
    ? (value as WatchlistStatus)
    : null
}

/** A plain object (not array/null) as sent in a JSON body. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Minimal structural check for a client-sent ModelInfo. */
function isModelInfo(value: unknown): value is ModelInfo {
  if (!isPlainObject(value)) return false
  const model = value as unknown as Partial<ModelInfo>
  return typeof model.slug === 'string' && model.slug.length > 0
    && typeof model.name === 'string'
    && typeof model.provider?.slug === 'string'
    && Array.isArray(model.prices)
    && isPlainObject(model.price)
}

function getRoute(path: string, run: () => Promise<unknown>): WebRoute {
  return {
    kind: 'exact',
    path,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      if (!requireMethod(req, res, 'GET')) return
      Promise.resolve(run()).then(
        (value) => json(res, 200, value),
        (error) => json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
    },
  }
}

/** Build the full route family. */
export function makeLlmQuotesRoutes(service: LlmRatesService, store: LlmQuotesStore): WebRoute[] {
  return [
    getRoute(`${LLM_QUOTES_API_PREFIX}/overview`, () => service.getOverview()),
    getRoute(`${LLM_QUOTES_API_PREFIX}/meta`, () => service.getMeta()),
    getRoute(`${LLM_QUOTES_API_PREFIX}/providers`, () => service.getProviders()),
    getRoute(`${LLM_QUOTES_API_PREFIX}/modalities`, () => service.getModalities()),
    {
      kind: 'exact',
      path: `${LLM_QUOTES_API_PREFIX}/models`,
      handler: (req: IncomingMessage, res: ServerResponse): void => {
        if (!requireMethod(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        Promise.resolve(service.getModels({
          q: url.searchParams.get('q') ?? undefined,
          provider: url.searchParams.get('provider') ?? undefined,
          modality: url.searchParams.get('modality') ?? undefined,
          page: url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined,
          pageSize: url.searchParams.has('pageSize') ? Number(url.searchParams.get('pageSize')) : undefined,
        })).then(
          (value) => json(res, 200, value),
          (error) => json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
      },
    },
    {
      kind: 'exact',
      path: `${LLM_QUOTES_API_PREFIX}/refresh`,
      handler: (req: IncomingMessage, res: ServerResponse): void => {
        if (!requireMethod(req, res, 'POST')) return
        Promise.resolve(service.ensureLoaded(true)).then((snapshot) => {
          json(res, 200, overviewFromSnapshot(snapshot))
        }, (error) => {
          json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        })
      },
    },
    {
      kind: 'exact',
      path: `${LLM_QUOTES_API_PREFIX}/provider-models`,
      handler: (req: IncomingMessage, res: ServerResponse): void => {
        if (!requireMethod(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const slugs = (url.searchParams.get('providers') ?? '')
          .split(',')
          .map((slug) => slug.trim().toLowerCase())
          .filter((slug) => slug.length > 0)
        if (slugs.length === 0) {
          json(res, 400, { ok: false, error: 'missing-providers' })
          return
        }
        Promise.resolve(service.getProviderModels(slugs)).then(
          // Deliberately NOT wrapped: the client consumes the record directly.
          (byProvider) => json(res, 200, byProvider),
          (error) => json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
      },
    },
    {
      kind: 'exact',
      path: `${LLM_QUOTES_API_PREFIX}/associations`,
      handler: (req: IncomingMessage, res: ServerResponse): void => {
        if (req.method === 'GET') {
          json(res, 200, { associations: store.listAssociations() })
          return
        }
        if (req.method === 'PUT') {
          void (async () => {
            try {
              const body = (await readJsonBody(req)) as Partial<ManualAssociation> | undefined
              const providerRoute = typeof body?.providerRoute === 'string' ? body.providerRoute.trim() : ''
              const modelId = typeof body?.modelId === 'string' ? body.modelId.trim() : ''
              const quoteProvider = typeof body?.quoteProvider === 'string' ? body.quoteProvider.trim() : ''
              const quoteModelSlug = typeof body?.quoteModelSlug === 'string' ? body.quoteModelSlug.trim() : ''
              if (providerRoute.length === 0 || quoteProvider.length === 0 || quoteModelSlug.length === 0) {
                json(res, 400, { ok: false, error: 'invalid-association' })
                return
              }
              const associations = store.setAssociation({ providerRoute, modelId, quoteProvider, quoteModelSlug })
              json(res, 200, { associations })
            } catch (error) {
              json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          })()
          return
        }
        if (req.method === 'DELETE') {
          void (async () => {
            try {
              const body = (await readJsonBody(req)) as { providerRoute?: unknown; modelId?: unknown } | undefined
              const providerRoute = typeof body?.providerRoute === 'string' ? body.providerRoute.trim() : ''
              const modelId = typeof body?.modelId === 'string' ? body.modelId.trim() : ''
              if (providerRoute.length === 0) {
                json(res, 400, { ok: false, error: 'invalid-association' })
                return
              }
              const associations = store.removeAssociation(providerRoute, modelId)
              json(res, 200, { associations })
            } catch (error) {
              json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          })()
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      },
    },
    {
      kind: 'exact',
      path: `${LLM_QUOTES_API_PREFIX}/settings`,
      handler: (req: IncomingMessage, res: ServerResponse): void => {
        if (req.method === 'GET') {
          Promise.resolve(store.settings()).then(
            (settings) => json(res, 200, { settings }),
            (error) => json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
          )
          return
        }
        if (req.method === 'POST') {
          void (async () => {
            try {
              const body = (await readJsonBody(req)) as { refreshMinutes?: unknown; compareLimit?: unknown }
              const result = store.updateSettings({
                refreshMinutes: typeof body.refreshMinutes === 'number' ? body.refreshMinutes : undefined,
                compareLimit: typeof body.compareLimit === 'number' ? body.compareLimit : undefined,
              })
              json(res, 200, result)
            } catch (error) {
              json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          })()
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      },
    },
    // Watchlist endpoints
    {
      kind: 'exact',
      path: `${LLM_QUOTES_API_PREFIX}/watchlist`,
      handler: (req: IncomingMessage, res: ServerResponse): void => {
        if (req.method === 'GET') {
          Promise.resolve(watchlist.getWatchlist()).then(
            (records) => json(res, 200, { records }),
            (error) => json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
          )
          return
        }
        if (req.method === 'PUT') {
          void (async () => {
            try {
              const body = (await readJsonBody(req)) as {
                model?: unknown
                providerSlug?: unknown
                status?: unknown
              }
              const providerSlug = typeof body?.providerSlug === 'string' ? body.providerSlug.trim() : ''
              if (!isModelInfo(body.model) || providerSlug.length === 0) {
                json(res, 400, { ok: false, error: 'invalid-model-or-provider' })
                return
              }
              const status = parseStatus(body.status, 'active')
              if (status === null) {
                json(res, 400, { ok: false, error: 'invalid-status' })
                return
              }
              const record = await watchlist.upsertWatchlist(
                body.model as ModelInfo,
                providerSlug,
                status,
              )
              json(res, 200, { record })
            } catch (error) {
              json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          })()
          return
        }
        if (req.method === 'DELETE') {
          void (async () => {
            try {
              const body = (await readJsonBody(req)) as { key?: unknown }
              const key = typeof body?.key === 'string' ? body.key.trim() : ''
              if (key.length === 0) {
                json(res, 400, { ok: false, error: 'missing-key' })
                return
              }
              const removed = await watchlist.removeWatchlist(key)
              json(res, 200, { removed })
            } catch (error) {
              json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          })()
          return
        }
        if (req.method === 'PATCH') {
          void (async () => {
            try {
              const body = (await readJsonBody(req)) as {
                key?: unknown
                status?: unknown
                price?: unknown
              }
              const key = typeof body?.key === 'string' ? body.key.trim() : ''
              if (key.length === 0) {
                json(res, 400, { ok: false, error: 'missing-key' })
                return
              }
              const hasStatus = body.status !== undefined
              const hasPrice = body.price !== undefined
              if (hasStatus && hasPrice) {
                json(res, 400, { ok: false, error: 'conflicting-patch' })
                return
              }
              // Status update (unfollow/pause, re-activate, archive).
              if (hasStatus) {
                const status = parseStatus(body.status, null)
                if (status === null) {
                  json(res, 400, { ok: false, error: 'invalid-status' })
                  return
                }
                const record = await watchlist.updateWatchlistStatus(key, status)
                if (!record) {
                  json(res, 404, { ok: false, error: 'not-found' })
                  return
                }
                json(res, 200, { record })
                return
              }
              // Price snapshot append.
              if (hasPrice) {
                if (!isPlainObject(body.price) || Object.keys(body.price).length === 0) {
                  json(res, 400, { ok: false, error: 'invalid-price' })
                  return
                }
                const record = await watchlist.appendPriceSnapshot(key, body.price as PriceInfo)
                if (!record) {
                  json(res, 404, { ok: false, error: 'not-found' })
                  return
                }
                json(res, 200, { record })
                return
              }
              json(res, 400, { ok: false, error: 'missing-status-or-price' })
            } catch (error) {
              json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
            }
          })()
          return
        }
        json(res, 405, { ok: false, error: 'method-not-allowed' })
      },
    },
    // Price change comparison endpoints
    {
      kind: 'exact',
      path: `${LLM_QUOTES_API_PREFIX}/watchlist/price-change`,
      handler: (req: IncomingMessage, res: ServerResponse): void => {
        if (!requireMethod(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const key = url.searchParams.get('key') ?? ''
        const fromTime = url.searchParams.get('from') ?? undefined
        const toTime = url.searchParams.get('to') ?? undefined
        if (key.length === 0) {
          json(res, 400, { ok: false, error: 'missing-key' })
          return
        }
        Promise.resolve(watchlist.getPriceChange(key, fromTime, toTime)).then(
          (result) => {
            if (!result) {
              json(res, 404, { ok: false, error: 'not-found' })
              return
            }
            json(res, 200, result)
          },
          (error) => json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
      },
    },
    {
      kind: 'exact',
      path: `${LLM_QUOTES_API_PREFIX}/watchlist/price-changes`,
      handler: (req: IncomingMessage, res: ServerResponse): void => {
        if (!requireMethod(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const keys = (url.searchParams.get('keys') ?? '')
          .split(',')
          .map((key) => key.trim())
          .filter((key) => key.length > 0)
          .slice(0, 500)
        Promise.resolve(watchlist.getPriceChanges(keys)).then(
          (changes) => json(res, 200, { changes }),
          (error) => json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
        )
      },
    },
  ]
}

/** Re-export for tests/consumers. */
export type { ManualAssociation }

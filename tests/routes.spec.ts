import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { LlmRatesService } from '../src/llmrates.ts'
import { makeLlmQuotesRoutes } from '../src/server/routes.ts'
import { LlmQuotesStore } from '../src/server/store.ts'
import type { ModelInfo } from '../src/types.ts'

let dir: string
let oldHome: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llm-quotes-routes-'))
  oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
})

afterEach(() => {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  rmSync(dir, { recursive: true, force: true })
})

describe('makeLlmQuotesRoutes', () => {
  it('registers each exact path at most once, including the watchlist API', () => {
    const routes = makeLlmQuotesRoutes(new LlmRatesService(), new LlmQuotesStore())
    const paths = routes
      .filter((route) => route.kind === 'exact')
      .map((route) => route.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain('/api/llm-quotes/settings')
    expect(paths).toContain('/api/llm-quotes/associations')
    expect(paths).toContain('/api/llm-quotes/provider-models')
    expect(paths).toContain('/api/llm-quotes/rates')
    expect(paths).toContain('/api/llm-quotes/watchlist')
    expect(paths).toContain('/api/llm-quotes/watchlist/price-change')
    expect(paths).toContain('/api/llm-quotes/watchlist/price-changes')
  })

  it('watchlist round-trip: follow → pause keeps the record and history', async () => {
    const routes = makeLlmQuotesRoutes(new LlmRatesService(), new LlmQuotesStore())
    const route = (path: string): WebRoute =>
      routes.find((r) => r.kind === 'exact' && r.path === path) as WebRoute

    const put = await call(route('/api/llm-quotes/watchlist'), 'PUT', '/api/llm-quotes/watchlist', {
      model: makeModel('m1', 1, 2),
      providerSlug: 'test',
    })
    expect(put.status).toBe(200)
    expect((put.body as { record: { status: string } }).record.status).toBe('active')

    const patch = await call(route('/api/llm-quotes/watchlist'), 'PATCH', '/api/llm-quotes/watchlist', {
      key: 'test:m1',
      status: 'paused',
    })
    expect(patch.status).toBe(200)
    expect((patch.body as { record: { status: string; priceHistory: unknown[] } }).record.status).toBe('paused')
    expect((patch.body as { record: { priceHistory: unknown[] } }).record.priceHistory).toHaveLength(1)

    const get = await call(route('/api/llm-quotes/watchlist'), 'GET', '/api/llm-quotes/watchlist')
    expect(get.status).toBe(200)
    const records = (get.body as { records: Array<{ key: string; status: string }> }).records
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ key: 'test:m1', status: 'paused' })
  })

  it('watchlist PUT rejects a malformed model and an invalid status', async () => {
    const routes = makeLlmQuotesRoutes(new LlmRatesService(), new LlmQuotesStore())
    const route = routes.find((r) => r.kind === 'exact' && r.path === '/api/llm-quotes/watchlist') as WebRoute

    const badModel = await call(route, 'PUT', '/api/llm-quotes/watchlist', {
      model: { slug: 'm1' }, // missing name/prices/price
      providerSlug: 'test',
    })
    expect(badModel.status).toBe(400)

    const badStatus = await call(route, 'PUT', '/api/llm-quotes/watchlist', {
      model: makeModel('m1', 1, 2),
      providerSlug: 'test',
      status: 'sleeping',
    })
    expect(badStatus.status).toBe(400)
  })
})

function makeModel(slug: string, input: number, output: number): ModelInfo {
  return {
    id: 1,
    sid: slug,
    name: slug,
    slug,
    provider: { name: 'Test', slug: 'test' },
    modalities: ['text'],
    price: { inputPricePerMillion: input, outputPricePerMillion: output, priceUnit: 'USD' },
    prices: [{ inputPricePerMillion: input, outputPricePerMillion: output, priceUnit: 'USD' }],
  }
}

/** Drive one route handler with a fake req/res pair. */
function call(route: WebRoute, method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter() as unknown as IncomingMessage
    Object.assign(req, { method, url })
    const res = {
      statusCode: 0,
      writeHead(this: { statusCode: number }, status: number): void {
        this.statusCode = status
      },
      end(this: { statusCode: number }, payload: string): void {
        resolve({ status: this.statusCode, body: JSON.parse(payload) })
      },
    } as unknown as ServerResponse
    try {
      route.handler(req, res)
      if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)))
      req.emit('end')
    } catch (error) {
      reject(error)
    }
  })
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LlmQuotesStore } from '../src/server/store.ts'

let dir: string
let oldHome: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llm-quotes-test-'))
  oldHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
})

afterEach(() => {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  rmSync(dir, { recursive: true, force: true })
})

describe('LlmQuotesStore', () => {
  it('updates settings with clamping', () => {
    const store = new LlmQuotesStore()
    const state = store.updateSettings({ compareLimit: 99, refreshMinutes: 30 })
    expect(state.settings.compareLimit).toBe(10)
    expect(state.settings.refreshMinutes).toBe(30)

    const reread = new LlmQuotesStore().settings()
    expect(reread.compareLimit).toBe(10)
    expect(reread.refreshMinutes).toBe(30)
  })
})

describe('associations', () => {
  it('upserts and removes manual associations keyed by route + model id', () => {
    const store = new LlmQuotesStore()
    const first = store.setAssociation({
      providerRoute: 'zzz-gateway',
      modelId: 'deepseek-v4-flash',
      quoteProvider: 'deepseek',
      quoteModelSlug: 'deepseek-v4-flash',
    })
    expect(first).toHaveLength(1)

    const updated = store.setAssociation({
      providerRoute: 'zzz-gateway',
      modelId: 'deepseek-v4-flash',
      quoteProvider: 'openai',
      quoteModelSlug: 'gpt-5',
    })
    expect(updated).toHaveLength(1)
    expect(updated[0]?.quoteProvider).toBe('openai')

    const afterRemove = store.removeAssociation('zzz-gateway', 'deepseek-v4-flash')
    expect(afterRemove).toHaveLength(0)
  })

  it('persists associations across store instances', () => {
    const store = new LlmQuotesStore()
    store.setAssociation({
      providerRoute: 'xai',
      modelId: 'grok-4.3',
      quoteProvider: 'xai',
      quoteModelSlug: 'grok-4.3',
    })
    expect(new LlmQuotesStore().listAssociations()).toHaveLength(1)
  })
})
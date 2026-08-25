import { describe, expect, it } from 'vitest'
import { normalizeDataset, queryModels } from '../src/llmrates.ts'
import type { DatasetSnapshot } from '../src/types.ts'

function sampleSnapshot(): DatasetSnapshot {
  const raw = {
    meta: { modelCount: 2, providerCount: 1, priceRowCount: 2 },
    providers: [
      { id: 1, slug: 'acme', name: 'Acme', modelCount: 2, providerType: 'direct', providerTypes: ['direct'] },
    ],
    models: [
      {
        id: 1,
        sid: 'acme-fast',
        name: 'Acme Fast',
        slug: 'acme-fast',
        family: null,
        modelType: 'chat',
        contextWindow: 128000,
        maxOutput: 4096,
        supportsTools: true,
        supportsBatch: false,
        supportsCaching: true,
        supportsStreaming: true,
        releaseDate: null,
        knowledgeCutoff: null,
        deprecatedAt: null,
        provider: { name: 'Acme', slug: 'acme', providerType: 'direct', providerTypes: ['direct'] },
        modalities: ['text'],
        prices: [{
          inputPricePerMillion: 1.25,
          outputPricePerMillion: 10,
          cachedInputPricePerMillion: 0.5,
          processingTier: 'standard',
          priceUnit: 'USD',
          sourceUrl: 'https://example.com/pricing',
          effectiveDate: '2026-01-01T00:00:00.000Z',
        }],
      },
      {
        id: 2,
        sid: 'acme-video',
        name: 'Acme Video',
        slug: 'acme-video',
        family: null,
        modelType: 'video',
        contextWindow: null,
        maxOutput: null,
        supportsTools: false,
        supportsBatch: false,
        supportsCaching: false,
        supportsStreaming: true,
        releaseDate: null,
        knowledgeCutoff: null,
        deprecatedAt: null,
        provider: { name: 'Acme', slug: 'acme', providerType: 'direct', providerTypes: ['direct'] },
        modalities: ['video'],
        prices: [{ videoPricePerSecond: 0.05, processingTier: 'standard', priceUnit: 'USD' }],
      },
    ],
  }
  return normalizeDataset(raw, 123)
}

describe('normalizeDataset', () => {
  it('maps raw LLMRates rows to compact models', () => {
    const snapshot = sampleSnapshot()
    expect(snapshot.meta.modelCount).toBe(2)
    expect(snapshot.models).toHaveLength(2)
    expect(snapshot.models[0]?.sid).toBe('acme-fast')
    expect(snapshot.models[0]?.price.inputPricePerMillion).toBe(1.25)
    expect(snapshot.models[1]?.price.videoPricePerSecond).toBe(0.05)
  })
})

describe('queryModels', () => {
  it('filters by query and provider', () => {
    const snapshot = sampleSnapshot()
    const result = queryModels(snapshot, { q: 'fast', provider: 'acme', page: 1, pageSize: 10 })
    expect(result.total).toBe(1)
    expect(result.models[0]?.sid).toBe('acme-fast')
  })

  it('filters by modality', () => {
    const snapshot = sampleSnapshot()
    const result = queryModels(snapshot, { modality: 'video' })
    expect(result.total).toBe(1)
    expect(result.models[0]?.sid).toBe('acme-video')
  })

  it('paginates safely', () => {
    const snapshot = sampleSnapshot()
    const result = queryModels(snapshot, { page: 99, pageSize: 1 })
    expect(result.total).toBe(2)
    expect(result.totalPages).toBe(2)
    expect(result.page).toBe(2)
    expect(result.models).toHaveLength(1)
  })
})

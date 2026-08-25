import { describe, expect, it } from 'vitest'
import type { ManualAssociation, ModelInfo, ProviderInfo } from '../src/types.ts'
import {
  findAssociation,
  findProviderAssociation,
  isExcludedPlanProvider,
  isProviderLevelAssociation,
  matchModelId,
  matchProviderRoute,
  quoteForAssociation,
} from '../src/client/matching.ts'

const quotesProviders: ProviderInfo[] = [
  { id: 1, slug: 'deepseek', name: 'DeepSeek', modelCount: 2 },
  { id: 2, slug: 'xai', name: 'xAI', modelCount: 19 },
  { id: 3, slug: 'google-gemini', name: 'Google', modelCount: 8 },
]

function model(slug: string, name: string): ModelInfo {
  return {
    id: 0,
    sid: `mdl_${slug}`,
    name,
    slug,
    provider: { name: 'x', slug: 'x' },
    modalities: ['text'],
    price: { inputPricePerMillion: 1, outputPricePerMillion: 2 },
    prices: [],
  }
}

describe('matchProviderRoute', () => {
  it('matches identical slugs directly', () => {
    expect(matchProviderRoute('xai', quotesProviders)).toBe('xai')
    expect(matchProviderRoute('deepseek', quotesProviders)).toBe('deepseek')
  })

  it('maps the harness official route to the dataset slug', () => {
    expect(matchProviderRoute('deepseek-official', quotesProviders)).toBe('deepseek')
  })

  it('maps known pi-ai catalog aliases', () => {
    expect(matchProviderRoute('google', quotesProviders)).toBe('google-gemini')
    expect(matchProviderRoute('google-vertex', quotesProviders)).toBe('google-gemini')
  })

  it('returns null for unknown routes (manual association flow)', () => {
    expect(matchProviderRoute('zzz-gateway', quotesProviders)).toBeNull()
    expect(matchProviderRoute('opencode-go', quotesProviders)).toBeNull()
  })

  it('lets a provider-level association override automatic matching', () => {
    const associations: ManualAssociation[] = [
      { providerRoute: 'xai', modelId: '', quoteProvider: 'deepseek', quoteModelSlug: '' },
    ]
    expect(matchProviderRoute('xai', quotesProviders, associations)).toBe('deepseek')
  })

  it('associates an otherwise unknown route at provider level', () => {
    const associations: ManualAssociation[] = [
      { providerRoute: 'zzz-gateway', modelId: '', quoteProvider: 'deepseek', quoteModelSlug: '' },
    ]
    expect(matchProviderRoute('zzz-gateway', quotesProviders, associations)).toBe('deepseek')
  })

  it('ignores model-level associations when matching the provider', () => {
    const associations: ManualAssociation[] = [
      { providerRoute: 'zzz-gateway', modelId: 'deepseek-v4-flash', quoteProvider: 'deepseek', quoteModelSlug: 'deepseek-v4-flash' },
    ]
    expect(matchProviderRoute('zzz-gateway', quotesProviders, associations)).toBeNull()
  })

  it('falls back to auto matching when the association points at a missing slug', () => {
    const associations: ManualAssociation[] = [
      { providerRoute: 'xai', modelId: '', quoteProvider: 'no-such-slug', quoteModelSlug: '' },
    ]
    expect(matchProviderRoute('xai', quotesProviders, associations)).toBe('xai')
  })
})

describe('matchModelId', () => {
  const models = [
    model('grok-4.3', 'Grok 4.3'),
    model('deepseek-v4-flash', 'DeepSeek V4 Flash'),
    model('jamba-large-1-7', 'AI21: Jamba Large 1.7'),
    model('claude-3-haiku', 'Anthropic: Claude 3 Haiku'),
    model('claude-haiku-4.5', 'Anthropic: Claude Haiku 4.5'),
  ]
  const byId = (id: string) => matchModelId({ id }, models)
  const byName = (name: string) => matchModelId({ id: 'zzz/nope', name }, models)

  it('① matches by exact slug', () => {
    expect(byId('grok-4.3')?.slug).toBe('grok-4.3')
  })

  it('② matches by case-insensitive display name', () => {
    expect(byName('Anthropic: Claude 3 Haiku')?.slug).toBe('claude-3-haiku')
    expect(byName('anthropic: claude 3 haiku')?.slug).toBe('claude-3-haiku')
  })

  it('③ matches vendor-prefixed ids and dot/dash spelling drift', () => {
    expect(byId('anthropic/claude-3-haiku')?.slug).toBe('claude-3-haiku')
    expect(byId('ai21/jamba-large-1.7')?.slug).toBe('jamba-large-1-7')
    expect(byId('vendor/jamba-large-1.7')?.slug).toBe('jamba-large-1-7')
  })

  it('④ matches names whose vendor prefixes and separators differ', () => {
    expect(matchModelId({ id: 'x/y', name: 'AI21: Jamba Large 1.7' }, models)?.slug).toBe('jamba-large-1-7')
    expect(matchModelId({ id: 'x/y', name: 'Jamba-Large-1_7' }, models)?.slug).toBe('jamba-large-1-7')
  })

  it('prefers an exact name (②) over the dash-normalized id (③)', () => {
    // Without a name, the prefixed id reaches ③; with the exact display
    // name the name match wins first.
    const prefixed = [model('claude-3-haiku', 'Anthropic: Claude 3 Haiku')]
    expect(matchModelId({ id: 'anthropic/claude-3-haiku' }, prefixed)?.slug).toBe('claude-3-haiku')
    expect(matchModelId({ id: 'zzz/other', name: 'Anthropic: Claude 3 Haiku' }, prefixed)?.slug).toBe('claude-3-haiku')
  })

  it('returns null when nothing matches', () => {
    expect(byId('grok-999')).toBeNull()
    expect(byId('')).toBeNull()
    expect(matchModelId({ id: 'grok-4.3' }, undefined)).toBeNull()
    expect(byName('No Such Model')).toBeNull()
  })
})

describe('associations', () => {
  const assoc: ManualAssociation[] = [
    { providerRoute: 'zzz-gateway', modelId: 'deepseek-v4-flash', quoteProvider: 'deepseek', quoteModelSlug: 'deepseek-v4-flash' },
    { providerRoute: 'opencode-go', modelId: '', quoteProvider: 'openrouter', quoteModelSlug: '' },
  ]

  it('classifies provider-level vs model-level associations', () => {
    expect(isProviderLevelAssociation(assoc[1]!)).toBe(true)
    expect(isProviderLevelAssociation(assoc[0]!)).toBe(false)
    expect(isProviderLevelAssociation({ providerRoute: 'x', modelId: undefined as unknown as string, quoteProvider: 'y', quoteModelSlug: '' })).toBe(true)
  })

  it('finds the provider-level association for a route', () => {
    expect(findProviderAssociation(assoc, 'opencode-go')?.quoteProvider).toBe('openrouter')
    expect(findProviderAssociation(assoc, 'zzz-gateway')).toBeUndefined()
    expect(findProviderAssociation(assoc, 'nope')).toBeUndefined()
  })

  it('finds a model association by route + model id', () => {
    expect(findAssociation(assoc, 'zzz-gateway', 'deepseek-v4-flash')?.quoteProvider).toBe('deepseek')
    expect(findAssociation(assoc, 'zzz-gateway', 'other')).toBeUndefined()
    // Provider-level rows are not model associations.
    expect(findAssociation(assoc, 'opencode-go', '')).toBeUndefined()
  })

  it('resolves the quote model an association points at', () => {
    const byProvider = { deepseek: [model('deepseek-v4-flash', 'DeepSeek V4 Flash')] }
    expect(quoteForAssociation(assoc[0]!, byProvider)?.slug).toBe('deepseek-v4-flash')
    expect(quoteForAssociation(assoc[0]!, {})).toBeNull()
  })
})

describe('isExcludedPlanProvider', () => {
  const provider = (slug: string, name: string, types: string[]): ProviderInfo => ({
    id: 0, slug, name, modelCount: 1, providerTypes: types,
  })

  it('excludes pure coding-plan products', () => {
    expect(isExcludedPlanProvider(provider('codebuddy', 'CodeBuddy', ['coding_tool']))).toBe(true)
    expect(isExcludedPlanProvider(provider('github-copilot', 'GitHub Copilot', ['coding_tool']))).toBe(true)
    expect(isExcludedPlanProvider(provider('trae', 'TRAE', ['coding_tool']))).toBe(true)
    expect(isExcludedPlanProvider(provider('qoder-cn', 'Qoder', ['coding_tool']))).toBe(true)
  })

  it('keeps API providers that also power coding tools', () => {
    expect(isExcludedPlanProvider(provider('openai', 'OpenAI', ['direct', 'coding_tool']))).toBe(false)
    expect(isExcludedPlanProvider(provider('anthropic', 'Anthropic', ['direct', 'coding_tool']))).toBe(false)
    // Aggregators resell models with per-token prices, so they stay selectable
    // even when they also power a coding tool.
    expect(isExcludedPlanProvider(provider('cursor', 'Cursor', ['aggregator', 'coding_tool']))).toBe(false)
    expect(isExcludedPlanProvider(provider('opencode-zen', 'OpenCode', ['aggregator', 'coding_tool']))).toBe(false)
    expect(isExcludedPlanProvider(provider('deepseek', 'DeepSeek', ['direct']))).toBe(false)
    expect(isExcludedPlanProvider(provider('openrouter', 'OpenRouter', ['aggregator']))).toBe(false)
    expect(isExcludedPlanProvider(provider('cloudflare', 'Cloudflare', []))).toBe(false)
  })

  it('catches explicit token/coding plan names', () => {
    expect(isExcludedPlanProvider(provider('qwen-token-plan', 'Qwen Token Plan', ['direct']))).toBe(true)
    expect(isExcludedPlanProvider(provider('foo', 'Foo Coding Plan', ['direct']))).toBe(true)
  })
})

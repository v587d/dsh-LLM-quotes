// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  PROVIDER_ASSOCIATIONS_KEY,
  loadProviderAssociations,
  providerAssociationsToManual,
  removeProviderAssociation,
  saveProviderAssociation,
} from '../src/client/providerAssociations.ts'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('provider-level associations (localStorage)', () => {
  it('loads an empty map by default', () => {
    expect(loadProviderAssociations()).toEqual({})
  })

  it('saves and reloads one association', () => {
    saveProviderAssociation('zzz-gateway', 'deepseek')
    expect(loadProviderAssociations()).toEqual({ 'zzz-gateway': 'deepseek' })
  })

  it('replaces an existing association for the same route', () => {
    saveProviderAssociation('zzz-gateway', 'deepseek')
    saveProviderAssociation('zzz-gateway', 'openrouter')
    expect(loadProviderAssociations()).toEqual({ 'zzz-gateway': 'openrouter' })
  })

  it('removes one association and keeps the others', () => {
    saveProviderAssociation('zzz-gateway', 'deepseek')
    saveProviderAssociation('opencode-go', 'openrouter')
    removeProviderAssociation('zzz-gateway')
    expect(loadProviderAssociations()).toEqual({ 'opencode-go': 'openrouter' })
  })

  it('tolerates corrupt stored JSON', () => {
    window.localStorage.setItem(PROVIDER_ASSOCIATIONS_KEY, '{not json')
    expect(loadProviderAssociations()).toEqual({})
  })

  it('projects onto the shared association list shape', () => {
    const manual = providerAssociationsToManual({ 'zzz-gateway': 'deepseek' })
    expect(manual).toEqual([
      { providerRoute: 'zzz-gateway', modelId: '', quoteProvider: 'deepseek', quoteModelSlug: '' },
    ])
  })
})

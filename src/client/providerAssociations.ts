/**
 * Client-side provider-level association storage.
 *
 * Provider-level associations (harness provider route → quotes-provider slug)
 * live in browser localStorage: the running dsh host process cannot hot-load
 * host-side changes, so this browser-owned preference needs no host route.
 * Model-level manual associations stay in the host store (`llm-quotes.json`).
 * @module dsh-llm-quotes/client/providerAssociations
 */

import type { ManualAssociation } from '../types.ts'

/** localStorage key: `Record<providerRoute, quoteProvider>` (slug map). */
export const PROVIDER_ASSOCIATIONS_KEY = 'llm-quotes.provider-associations'

/** Read the stored route → quote-provider map ({} when empty/unavailable). */
export function loadProviderAssociations(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(PROVIDER_ASSOCIATIONS_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [route, slug] of Object.entries(parsed as Record<string, unknown>)) {
      if (route.length > 0 && typeof slug === 'string' && slug.length > 0) out[route] = slug
    }
    return out
  } catch {
    return {}
  }
}

/** Persist one provider-level association. */
export function saveProviderAssociation(route: string, quoteProvider: string): void {
  const next = { ...loadProviderAssociations(), [route]: quoteProvider }
  try {
    window.localStorage.setItem(PROVIDER_ASSOCIATIONS_KEY, JSON.stringify(next))
  } catch {
    // Storage unavailable (private mode etc.); the association is lost on reload.
  }
}

/** Remove the provider-level association for one route. */
export function removeProviderAssociation(route: string): void {
  const next = { ...loadProviderAssociations() }
  delete next[route]
  try {
    window.localStorage.setItem(PROVIDER_ASSOCIATIONS_KEY, JSON.stringify(next))
  } catch {
    // Ignore.
  }
}

/** Project the stored map onto the shared association list shape. */
export function providerAssociationsToManual(record: Record<string, string>): ManualAssociation[] {
  return Object.entries(record).map(([providerRoute, quoteProvider]) => ({
    providerRoute,
    modelId: '',
    quoteProvider,
    quoteModelSlug: '',
  }))
}

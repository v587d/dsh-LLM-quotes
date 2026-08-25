/**
 * Shared quotes data for the Settings → Models per-provider quote blocks:
 * the harness's configured providers, the quotes-dataset providers,
 * per-provider model lists, and manual associations.
 *
 * The former watch state is gone: configured harness models are implicitly
 * the watched set, so the blocks only need quote data.
 * @module dsh-llm-quotes/client/useQuotesData
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  HarnessProviderRef,
  ManualAssociation,
  MetaResponse,
  ModelInfo,
  ProviderInfo,
} from '../types.ts'
import type { LlmQuotesApi } from './index.ts'
import { matchProviderRoute } from './matching.ts'
import {
  loadProviderAssociations,
  providerAssociationsToManual,
  removeProviderAssociation as removeStoredProviderAssociation,
  saveProviderAssociation as saveStoredProviderAssociation,
} from './providerAssociations.ts'

export interface QuotesDataState {
  /** True while the initial data load is in flight. */
  readonly loading: boolean
  /** Load failure text, or null. */
  readonly error: string | null
  /** Configured harness providers (null until the first load settles). */
  readonly configured: readonly HarnessProviderRef[] | null
  /** All quotes-dataset providers. */
  readonly quotesProviders: readonly ProviderInfo[]
  /** Full model lists per quotes-provider slug. */
  readonly byProvider: Record<string, readonly ModelInfo[]>
  /** Stored manual associations: browser provider-level + host model-level. */
  readonly associations: readonly ManualAssociation[]
  /** Dataset metadata (source update date vs local fetch time); null until loaded. */
  readonly meta: MetaResponse | null
  /** Re-run the full data load. */
  readonly reload: () => void
  /** Associate one whole harness provider with a quotes provider. */
  readonly setProviderAssociation: (route: string, quoteProvider: string) => Promise<void>
  /** Remove the provider-level association of one harness provider. */
  readonly removeProviderAssociation: (route: string) => Promise<void>
  /** Upsert one model-level manual association (host store). */
  readonly setAssociation: (association: ManualAssociation) => Promise<void>
  /** Remove one model-level manual association (host store). */
  readonly removeAssociation: (route: string, modelId: string) => Promise<void>
}

/** Read both association sources: browser provider-level + host model-level. */
function readAssociations(): ManualAssociation[] {
  const local = loadProviderAssociations()
  return providerAssociationsToManual(local)
}

/** Load the shared quotes data once per mount of the settings panel. */
export function useQuotesData(api: LlmQuotesApi): QuotesDataState {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState<readonly HarnessProviderRef[] | null>(null)
  const [quotesProviders, setQuotesProviders] = useState<readonly ProviderInfo[]>([])
  const [byProvider, setByProvider] = useState<Record<string, readonly ModelInfo[]>>({})
  const [associations, setAssociations] = useState<readonly ManualAssociation[]>([])
  const [meta, setMeta] = useState<MetaResponse | null>(null)
  const mounted = useRef(true)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [cfg, providers, serverAssoc] = await Promise.all([
        api.harnessConfigured(),
        api.providers(),
        api.associations(),
      ])
      // Metadata is best-effort: an old host without /meta degrades to null
      // (sync date shows '—') instead of failing the whole load.
      const datasetMeta = await api.meta().catch(() => null)
      const localAssoc = readAssociations()
      const assoc = [...localAssoc, ...serverAssoc]
      const wanted = new Set<string>()
      for (const provider of cfg) {
        const matched = matchProviderRoute(provider.route, providers, assoc)
        if (matched !== null) wanted.add(matched)
      }
      for (const item of assoc) wanted.add(item.quoteProvider)
      const models = wanted.size > 0 ? await api.providerModels([...wanted]) : {}
      if (!mounted.current) return
      setConfigured(cfg)
      setQuotesProviders(providers)
      setAssociations(assoc)
      setByProvider(models)
      setMeta(datasetMeta)
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [api])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
    }
  }, [load])

  /** Model-level associations currently held by the host store. */
  const serverModelAssociations = associations.filter((item) => item.modelId.length > 0)

  const setProviderAssociation = useCallback(async (route: string, quoteProvider: string): Promise<void> => {
    saveStoredProviderAssociation(route, quoteProvider)
    setAssociations([...readAssociations(), ...serverModelAssociations])
    // Make the associated provider's model list available for immediate display.
    setByProvider((prev) => {
      if (prev[quoteProvider] !== undefined) return prev
      void api.providerModels([quoteProvider]).then((models) => {
        setByProvider((current) => ({ ...current, ...models }))
      }, () => {
        // Ignore; rows stay unmatched until the next full reload.
      })
      return prev
    })
  }, [api, serverModelAssociations])

  const removeProviderAssociation = useCallback(async (route: string): Promise<void> => {
    removeStoredProviderAssociation(route)
    setAssociations([...readAssociations(), ...serverModelAssociations])
  }, [serverModelAssociations])

  const setAssociation = useCallback(async (association: ManualAssociation): Promise<void> => {
    const next = await api.setAssociation(association)
    const local = readAssociations()
    setAssociations([...local, ...next])
    // Make the associated provider's model list available for immediate display.
    setByProvider((prev) => {
      if (prev[association.quoteProvider] !== undefined) return prev
      void api.providerModels([association.quoteProvider]).then((models) => {
        setByProvider((current) => ({ ...current, ...models }))
      }, () => {
        // Ignore; rows stay unmatched until the next full reload.
      })
      return prev
    })
  }, [api])

  const removeAssociation = useCallback(async (route: string, modelId: string): Promise<void> => {
    const next = await api.removeAssociation(route, modelId)
    const local = readAssociations()
    setAssociations([...local, ...next])
  }, [api])

  return {
    loading,
    error,
    configured,
    quotesProviders,
    byProvider,
    associations,
    meta,
    reload: load,
    setProviderAssociation,
    removeProviderAssociation,
    setAssociation,
    removeAssociation,
  }
}
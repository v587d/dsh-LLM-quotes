/**
 * Shared types for dsh-llm-quotes.
 * These types are intentionally small and browser-safe: the host normalizes
 * the large LLMRates dataset before sending anything to the client.
 * @module dsh-llm-quotes/types
 */

/** A provider reference as embedded in a model row. */
export interface ProviderRef {
  readonly name: string
  readonly slug: string
  readonly providerType?: string
  readonly providerTypes?: readonly string[]
  readonly baseUrl?: string
}

/** One normalized provider row for the UI. */
export interface ProviderInfo {
  readonly id: number
  readonly slug: string
  readonly name: string
  readonly nameLocal?: string | null
  readonly website?: string
  readonly pricingUrl?: string
  readonly description?: string
  readonly modelCount: number
  readonly providerType?: string
  readonly providerTypes?: readonly string[]
}

/** One price row, keeping the fields most useful for display/comparison. */
export interface PriceInfo {
  readonly inputPricePerMillion?: number | null
  readonly outputPricePerMillion?: number | null
  readonly thinkingOutputPricePerMillion?: number | null
  readonly cachedInputPricePerMillion?: number | null
  readonly cachedWritePricePerMillion?: number | null
  readonly imagePrice?: number | null
  readonly imagePricePerMillion?: number | null
  readonly audioPricePerHour?: number | null
  readonly audioPricePerMillion?: number | null
  readonly videoPrice?: number | null
  readonly videoPricePerSecond?: number | null
  readonly videoPricePerMillion?: number | null
  readonly characterPricePerMillion?: number | null
  readonly pagePrice?: number | null
  readonly searchPricePerThousand?: number | null
  readonly trackPrice?: number | null
  readonly processingTier?: string | null
  readonly tokenTierMin?: number | null
  readonly tokenTierMax?: number | null
  readonly tierLabel?: string | null
  readonly priceUnit?: string | null
  readonly freeTier?: string | null
  readonly region?: string | null
  readonly sourceUrl?: string
  readonly effectiveDate?: string
}

/** One normalized model row for the UI. */
export interface ModelInfo {
  readonly id: number
  /** Stable LLMRates model identity, used for compare/details. */
  readonly sid: string
  readonly name: string
  readonly slug: string
  readonly family?: string | null
  readonly modelType?: string | null
  readonly contextWindow?: number | null
  readonly maxOutput?: number | null
  readonly supportsTools?: boolean
  readonly supportsBatch?: boolean
  readonly supportsCaching?: boolean
  readonly supportsStreaming?: boolean
  readonly releaseDate?: string | null
  readonly knowledgeCutoff?: string | null
  readonly deprecatedAt?: string | null
  readonly provider: ProviderRef
  readonly modalities: readonly string[]
  /** Primary price row (first in the raw `prices` list, usually standard). */
  readonly price: PriceInfo
  readonly prices: readonly PriceInfo[]
}

/** Full normalized dataset snapshot. */
export interface DatasetSnapshot {
  readonly fetchedAt: number
  readonly meta: {
    readonly modelCount: number
    readonly providerCount: number
    readonly priceRowCount: number
    readonly source?: string
    readonly license?: string
    /** Source `Last-Modified` when the server provides it (dataset update date). */
    readonly updatedAt?: string
  }
  readonly providers: readonly ProviderInfo[]
  readonly models: readonly ModelInfo[]
}

/** Browser-facing dataset metadata (sync date source). */
export interface MetaResponse {
  /** Local fetch time of the current snapshot. */
  readonly fetchedAt: number
  /** Source `Last-Modified` of the dataset, when available. */
  readonly updatedAt: string | null
}

/** Browser-facing overview payload. */
export interface OverviewResponse {
  readonly fetchedAt: number
  readonly providers: readonly ProviderInfo[]
  readonly models: readonly ModelInfo[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly totalPages: number
  readonly stale?: boolean
  readonly error?: string
  readonly message?: string
}

/** Browser-facing models list payload. */
export interface ModelsResponse {
  readonly models: readonly ModelInfo[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly totalPages: number
  readonly fetchedAt: number
  readonly stale?: boolean
  readonly error?: string
  readonly message?: string
}

/** User-configurable settings. */
export interface AppSettings {
  readonly refreshMinutes: number
  readonly compareLimit: number
}

/** Local JSON store shape. */
export interface StoreData {
  readonly version: 1
  readonly settings: AppSettings
  readonly associations: readonly ManualAssociation[]
}

/** Browser-facing settings response. */
export interface SettingsResponse {
  readonly settings: AppSettings
}

/**
 * A manual association between a harness provider/model (Settings → Models)
 * and the quotes dataset.
 *
 * Two levels, stored in one list:
 * - Provider-level: `modelId` is '' — the whole harness provider is pointed
 *   at one quotes-provider, and each model then matches by slug/name. This is
 *   the preferred level: associate providers, not models.
 * - Model-level: `modelId` + `quoteModelSlug` point one harness model at one
 *   dataset model — the last-resort fallback when slug matching cannot
 *   confirm a model inside an already-associated provider.
 */
export interface ManualAssociation {
  /** Harness provider route/slug from Settings → Models. */
  readonly providerRoute: string
  /** Harness model id; '' (or absent) = provider-level association. */
  readonly modelId: string
  /** Quotes dataset provider slug the association points at. */
  readonly quoteProvider: string
  /** Quotes dataset model slug; '' for provider-level associations. */
  readonly quoteModelSlug: string
}

/** Browser-facing associations response. */
export interface AssociationResponse {
  readonly associations: readonly ManualAssociation[]
}

/** One model the harness exposes for a configured provider. */
export interface HarnessModelRef {
  /** Model id as configured in Settings → Models (or the catalog). */
  readonly id: string
  /** Display name from the harness catalog, when disclosed. */
  readonly name?: string | null
  /** True when the user explicitly listed the model in the provider profile. */
  readonly explicit: boolean
}

/** One configured harness provider, normalized for the quotes block. */
export interface HarnessProviderRef {
  /** Route slug (Settings → Models key), e.g. `xai`, `deepseek-official`. */
  readonly route: string
  /** Human-facing display name from the harness, e.g. `xAI`. */
  readonly displayName: string
  /** Whether the route currently has a registered adapter. */
  readonly active: boolean
  /** The models this provider serves (explicit config or full catalog). */
  readonly models: readonly HarnessModelRef[]
}

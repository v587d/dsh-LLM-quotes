/**
 * LLMRates.ai client + normalization + host-side cache.
 *
 * The full dataset endpoint (`/api/dataset`) is ~3 MB and updates daily.
 * We fetch it on the host, normalize it to a compact shape, and persist it
 * only after a successful fetch. On failure we keep serving the last good
 * local snapshot when one exists.
 * @module dsh-llm-quotes/llmrates
 */

import { loadDataSnapshot, saveDataSnapshot } from './config.ts'
import type {
  DatasetSnapshot,
  MetaResponse,
  ModelInfo,
  ModelsResponse,
  OverviewResponse,
  PriceInfo,
  ProviderInfo,
  ProviderRef,
} from './types.ts'

/** LLMRates base URL. */
export const LLMRATES_BASE_URL = 'https://www.llmrates.ai'
/** Dataset endpoint. */
export const DATASET_URL = `${LLMRATES_BASE_URL}/api/dataset`
/** HTTP timeout for the full dataset fetch. */
export const FETCH_TIMEOUT_MS = 60_000

// ---------------------------------------------------------------------------
// Raw LLMRates dataset shapes (only the fields we need)
// ---------------------------------------------------------------------------

interface RawDataset {
  meta: {
    name?: string
    publisher?: string
    source?: string
    datasetUrl?: string
    repoUrl?: string
    license?: string
    licenseUrl?: string
    attribution?: string
    note?: string
    modelCount: number
    providerCount: number
    priceRowCount: number
  }
  providers: RawProvider[]
  models: RawModel[]
}

interface RawProvider {
  id: number
  slug: string
  name: string
  nameLocal?: string | null
  website?: string
  pricingUrl?: string
  providerType?: string
  providerTypes?: string[]
  description?: string
  modelCount: number
}

interface RawProviderRef {
  name: string
  slug: string
  providerType?: string
  providerTypes?: string[]
  baseUrl?: string
}

interface RawModel {
  id: number
  sid: string
  name: string
  slug: string
  family?: string | null
  modelType?: string | null
  contextWindow?: number | null
  maxOutput?: number | null
  supportsTools?: boolean
  supportsBatch?: boolean
  supportsCaching?: boolean
  supportsStreaming?: boolean
  releaseDate?: string | null
  knowledgeCutoff?: string | null
  deprecatedAt?: string | null
  provider: RawProviderRef
  modalities: string[]
  prices: RawPrice[]
}

interface RawPrice {
  inputPricePerMillion?: number | null
  outputPricePerMillion?: number | null
  thinkingOutputPricePerMillion?: number | null
  cachedInputPricePerMillion?: number | null
  cachedWritePricePerMillion?: number | null
  imagePrice?: number | null
  imagePricePerMillion?: number | null
  audioPricePerHour?: number | null
  audioPricePerMillion?: number | null
  videoPrice?: number | null
  videoPricePerSecond?: number | null
  videoPricePerMillion?: number | null
  characterPricePerMillion?: number | null
  pagePrice?: number | null
  searchPricePerThousand?: number | null
  trackPrice?: number | null
  processingTier?: string | null
  tokenTierMin?: number | null
  tokenTierMax?: number | null
  tierLabel?: string | null
  priceUnit?: string | null
  freeTier?: string | null
  region?: string | null
  sourceUrl?: string
  effectiveDate?: string
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function normalizeProvider(raw: RawProvider): ProviderInfo {
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    nameLocal: raw.nameLocal ?? null,
    website: raw.website,
    pricingUrl: raw.pricingUrl,
    description: raw.description,
    modelCount: raw.modelCount,
    providerType: raw.providerType,
    providerTypes: raw.providerTypes ?? [],
  }
}

function normalizeProviderRef(raw: RawProviderRef): ProviderRef {
  return {
    name: raw.name,
    slug: raw.slug,
    providerType: raw.providerType,
    providerTypes: raw.providerTypes ?? [],
    baseUrl: raw.baseUrl,
  }
}

function normalizePrice(raw: RawPrice): PriceInfo {
  return {
    inputPricePerMillion: raw.inputPricePerMillion ?? null,
    outputPricePerMillion: raw.outputPricePerMillion ?? null,
    thinkingOutputPricePerMillion: raw.thinkingOutputPricePerMillion ?? null,
    cachedInputPricePerMillion: raw.cachedInputPricePerMillion ?? null,
    cachedWritePricePerMillion: raw.cachedWritePricePerMillion ?? null,
    imagePrice: raw.imagePrice ?? null,
    imagePricePerMillion: raw.imagePricePerMillion ?? null,
    audioPricePerHour: raw.audioPricePerHour ?? null,
    audioPricePerMillion: raw.audioPricePerMillion ?? null,
    videoPrice: raw.videoPrice ?? null,
    videoPricePerSecond: raw.videoPricePerSecond ?? null,
    videoPricePerMillion: raw.videoPricePerMillion ?? null,
    characterPricePerMillion: raw.characterPricePerMillion ?? null,
    pagePrice: raw.pagePrice ?? null,
    searchPricePerThousand: raw.searchPricePerThousand ?? null,
    trackPrice: raw.trackPrice ?? null,
    processingTier: raw.processingTier ?? null,
    tokenTierMin: raw.tokenTierMin ?? null,
    tokenTierMax: raw.tokenTierMax ?? null,
    tierLabel: raw.tierLabel ?? null,
    priceUnit: raw.priceUnit ?? null,
    freeTier: raw.freeTier ?? null,
    region: raw.region ?? null,
    sourceUrl: raw.sourceUrl,
    effectiveDate: raw.effectiveDate,
  }
}

function normalizeModel(raw: RawModel): ModelInfo {
  const prices = (raw.prices ?? []).map(normalizePrice)
  return {
    id: raw.id,
    sid: raw.sid,
    name: raw.name,
    slug: raw.slug,
    family: raw.family ?? null,
    modelType: raw.modelType ?? null,
    contextWindow: raw.contextWindow ?? null,
    maxOutput: raw.maxOutput ?? null,
    supportsTools: raw.supportsTools ?? false,
    supportsBatch: raw.supportsBatch ?? false,
    supportsCaching: raw.supportsCaching ?? false,
    supportsStreaming: raw.supportsStreaming ?? false,
    releaseDate: raw.releaseDate ?? null,
    knowledgeCutoff: raw.knowledgeCutoff ?? null,
    deprecatedAt: raw.deprecatedAt ?? null,
    provider: normalizeProviderRef(raw.provider),
    modalities: raw.modalities ?? [],
    price: prices[0] ?? {},
    prices,
  }
}

/** Normalize a raw LLMRates dataset into the compact snapshot shape.
 * `updatedAt` is the source's `Last-Modified` (dataset update date) when the
 * server provides one. */
export function normalizeDataset(raw: RawDataset, fetchedAt = Date.now(), updatedAt?: string | null): DatasetSnapshot {
  return {
    fetchedAt,
    meta: {
      modelCount: raw.meta.modelCount,
      providerCount: raw.meta.providerCount,
      priceRowCount: raw.meta.priceRowCount,
      source: raw.meta.source,
      license: raw.meta.license,
      updatedAt: updatedAt ?? undefined,
    },
    providers: raw.providers.map(normalizeProvider),
    models: raw.models.map(normalizeModel),
  }
}

// ---------------------------------------------------------------------------
// Filtering / pagination (pure and unit-testable)
// ---------------------------------------------------------------------------

export interface ModelQuery {
  q?: string
  provider?: string
  modality?: string
  page?: number
  pageSize?: number
}

/** Filter a snapshot by query and return a page window. */
export function queryModels(
  snapshot: DatasetSnapshot,
  query: ModelQuery = {},
): { models: ModelInfo[]; total: number; page: number; pageSize: number; totalPages: number } {
  const q = query.q?.trim().toLowerCase() ?? ''
  const provider = query.provider?.trim().toLowerCase() ?? ''
  const modality = query.modality?.trim().toLowerCase() ?? ''
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const pageSize = Math.min(200, Math.max(1, Math.floor(query.pageSize ?? 50)))

  const filtered = snapshot.models.filter((model) => {
    if (q.length > 0) {
      const haystack = `${model.name} ${model.slug} ${model.provider.name} ${model.provider.slug}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (provider.length > 0 && model.provider.slug.toLowerCase() !== provider) return false
    if (modality.length > 0 && !model.modalities.some((m) => m.toLowerCase() === modality)) return false
    return true
  })

  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * pageSize
  return {
    models: filtered.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages,
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Host-side cached LLMRates service. */
export class LlmRatesService {
  private memory: DatasetSnapshot | null = null
  private memoryLoadedAt = 0
  private inflight: Promise<DatasetSnapshot> | undefined

  /**
   * Fresh means "fetched on the same calendar day" — the sync cadence is at
   * most once per day (see `needsRefresh`). The legacy `refreshMinutes`
   * setting is no longer the sync driver; a stored smaller value is
   * tolerated and simply ignored.
   */
  private isFresh(snapshot: DatasetSnapshot): boolean {
    return sameLocalDay(snapshot.fetchedAt, Date.now())
  }

  /**
   * True when the best available snapshot was NOT fetched today — i.e. a
   * background sync should fetch once (the first time dsh opens that day).
   */
  needsRefresh(): boolean {
    const snapshot = this.memory ?? loadDataSnapshot()
    return snapshot === null || !sameLocalDay(snapshot.fetchedAt, Date.now())
  }

  /**
   * Return the best available snapshot. If the in-memory/file copy is fresh,
   * use it. Otherwise fetch the full dataset; on success write the snapshot
   * to disk. On failure, keep the last good copy if one exists (marked stale).
   */
  async ensureLoaded(force = false): Promise<DatasetSnapshot> {
    if (!force && this.memory !== null && this.isFresh(this.memory)) return this.memory
    if (this.inflight !== undefined) return this.inflight

    this.inflight = (async () => {
      try {
        const { raw, lastModified } = await fetchDatasetRaw()
        const snapshot = normalizeDataset(raw, Date.now(), lastModified)
        saveDataSnapshot(snapshot)
        this.memory = snapshot
        this.memoryLoadedAt = Date.now()
        return snapshot
      } catch (error) {
        const disk = this.memory ?? loadDataSnapshot()
        if (disk !== null) {
          this.memory = disk
          this.memoryLoadedAt = Date.now()
          return disk
        }
        throw error
      } finally {
        this.inflight = undefined
      }
    })()

    return this.inflight
  }

  /** Force a fresh fetch (used by the refresh endpoint). */
  async refresh(): Promise<OverviewResponse> {
    const snapshot = await this.ensureLoaded(true)
    return overviewFromSnapshot(snapshot)
  }

  /** Dataset metadata for the sync-date display (source update vs local fetch). */
  async getMeta(): Promise<MetaResponse> {
    const snapshot = await this.ensureLoaded()
    return {
      fetchedAt: snapshot.fetchedAt,
      updatedAt: snapshot.meta.updatedAt ?? null,
    }
  }

  /** Get providers + first page of models. */
  async getOverview(): Promise<OverviewResponse> {
    const snapshot = await this.ensureLoaded()
    return overviewFromSnapshot(snapshot)
  }

  /** Get filtered/paginated models. */
  async getModels(query: ModelQuery = {}): Promise<ModelsResponse> {
    const snapshot = await this.ensureLoaded()
    const result = queryModels(snapshot, query)
    return {
      ...result,
      fetchedAt: snapshot.fetchedAt,
      stale: !this.isFresh(snapshot),
    }
  }

  /**
   * Full (unpaginated) model lists for a set of provider slugs — the quote
   * blocks' one-shot lookup, so matching is never clipped by the paged
   * endpoint's page-size cap.
   */
  async getProviderModels(slugs: readonly string[]): Promise<Record<string, readonly ModelInfo[]>> {
    const snapshot = await this.ensureLoaded()
    const wanted = new Set(slugs)
    const byProvider: Record<string, ModelInfo[]> = {}
    for (const model of snapshot.models) {
      const slug = model.provider.slug
      if (!wanted.has(slug)) continue
      ;(byProvider[slug] ??= []).push(model)
    }
    return byProvider
  }

  /** Get all providers. */
  async getProviders(): Promise<ProviderInfo[]> {
    const snapshot = await this.ensureLoaded()
    return snapshot.providers.slice()
  }

  /** Get all distinct model modalities from the current snapshot. */
  async getModalities(): Promise<string[]> {
    const snapshot = await this.ensureLoaded()
    const set = new Set<string>()
    for (const model of snapshot.models) {
      for (const modality of model.modalities) set.add(modality)
    }
    return [...set].sort()
  }
}

export function overviewFromSnapshot(snapshot: DatasetSnapshot): OverviewResponse {
  const first = queryModels(snapshot, { page: 1, pageSize: 50 })
  return {
    fetchedAt: snapshot.fetchedAt,
    providers: snapshot.providers,
    models: first.models,
    total: first.total,
    page: first.page,
    pageSize: first.pageSize,
    totalPages: first.totalPages,
    stale: !sameLocalDay(snapshot.fetchedAt, Date.now()),
  }
}

/** True when two epoch-millis timestamps fall on the same local calendar day. */
export function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
}

/** A fetched dataset plus its source `Last-Modified` header, when sent. */
export interface FetchedDataset {
  readonly raw: RawDataset
  readonly lastModified: string | null
}

/** Fetch the raw LLMRates dataset with a timeout; also captures the source's
 * `Last-Modified` header (the dataset update date) when the server sends it. */
export async function fetchDatasetRaw(): Promise<FetchedDataset> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(DATASET_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`LLMRates dataset request failed: HTTP ${response.status}`)
    }
    const lastModified = response.headers.get('last-modified')
    return {
      raw: (await response.json()) as RawDataset,
      lastModified: lastModified !== null && lastModified.length > 0 ? lastModified : null,
    }
  } finally {
    clearTimeout(timer)
  }
}

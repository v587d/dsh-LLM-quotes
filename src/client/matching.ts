/**
 * Pure matching between the harness's Settings → Models provider routes
 * and the quotes dataset provider slugs.
 *
 * The harness route is the settings key a provider profile lives under
 * (`deepseek-official` from the harness's own adapter, `xai`/`opencode-go`
 * from the pi-ai catalog, or a user hand-declared route). The quotes
 * dataset uses its own canonical slugs (`deepseek`, `xai`, …), so matching
 * is: explicit provider-level association → exact slug → built-in alias →
 * none (manual association). Models inside a matched provider then match by
 * slug/name; a per-model manual association remains the last resort.
 * @module dsh-llm-quotes/client/matching
 */

import type { ManualAssociation, ModelInfo, ProviderInfo } from '../types.ts'

/**
 * Known harness route → quotes-provider slug aliases. Entries only exist
 * where the two vocabularies differ; identical slugs match directly without
 * needing an entry here.
 */
export const PROVIDER_SLUG_ALIASES: Readonly<Record<string, string>> = {
  // Harness's own official adapter route.
  'deepseek-official': 'deepseek',
  // pi-ai catalog routes whose dataset slug differs.
  'openai-codex': 'openai',
  google: 'google-gemini',
  'google-vertex': 'google-gemini',
  'minimax-cn': 'minimax',
  moonshotai: 'moonshot',
  'moonshotai-cn': 'moonshot',
  'qwen-token-plan': 'qwen',
  'qwen-token-plan-cn': 'qwen',
  zai: 'zhipu',
  'zai-coding-cn': 'zhipu',
  'cloudflare-workers-ai': 'cloudflare',
  'cloudflare-ai-gateway': 'cloudflare',
  'amazon-bedrock': 'aws-bedrock',
  'azure-openai-responses': 'azure-ai',
  opencode: 'opencode-zen',
}

/** True for a provider-level association (`modelId` absent or empty). */
export function isProviderLevelAssociation(association: ManualAssociation): boolean {
  return (association.modelId ?? '').length === 0
}

/** The stored provider-level association for one harness route, if any. */
export function findProviderAssociation(
  associations: readonly ManualAssociation[],
  providerRoute: string,
): ManualAssociation | undefined {
  return associations.find(
    (item) => item.providerRoute === providerRoute && isProviderLevelAssociation(item),
  )
}

/**
 * Resolve a harness provider route to a quotes-provider slug, or null when
 * the dataset has no candidate (the caller then guides manual association).
 * A stored provider-level association wins over automatic matching.
 */
export function matchProviderRoute(
  route: string,
  quotesProviders: readonly ProviderInfo[],
  associations: readonly ManualAssociation[] = [],
): string | null {
  const associated = findProviderAssociation(associations, route)
  if (associated !== undefined && quotesProviders.some((provider) => provider.slug === associated.quoteProvider)) {
    return associated.quoteProvider
  }
  if (quotesProviders.some((provider) => provider.slug === route)) return route
  const aliased = PROVIDER_SLUG_ALIASES[route]
  if (aliased !== undefined && quotesProviders.some((provider) => provider.slug === aliased)) {
    return aliased
  }
  return null
}

/** The harness side of a model match: its id plus its display name when
 * the harness discloses one (catalog or explicit profile entries). */
export interface ModelMatchInput {
  /** Harness model id, e.g. `anthropic/claude-3-haiku`. */
  readonly id: string
  /** Harness display name, e.g. `Anthropic: Claude 3 Haiku`, when known. */
  readonly name?: string | null
}

/** Lowercase and strip every non-alphanumeric character. */
function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Drop a leading `<Vendor>: ` prefix from a display name (both sides of
 * the dataset use it, often with different vendor spellings). */
function stripVendorName(value: string): string {
  return value.replace(/^[^:：]+[:：]\s*/, '').trim()
}

/** Drop the `vendor/` prefix from a harness model id. */
function stripIdPrefix(modelId: string): string {
  const slash = modelId.indexOf('/')
  return slash > 0 ? modelId.slice(slash + 1) : modelId
}

/**
 * Resolve a harness model against one provider's quotes models. The whole
 * chain consists of exact-equality checks only (no fuzzy guessing, per the
 * conservative rule set confirmed with the user); first hit wins:
 *
 * ① harness id === dataset slug
 * ② harness display name === dataset name (case-insensitive full equality)
 * ③ id with `vendor/` prefix stripped and `.` → `-` === dataset slug
 *    (dsh ids are `vendor/name.with.dots`, dataset slugs `name-with-dashes`)
 * ④ names with `<Vendor>: ` prefixes stripped, lowercased and normalized
 *    (non-alphanumerics removed) equal
 *
 * Steps ②/④ need a disclosed harness name; without one they are skipped.
 */
export function matchModelId(
  model: ModelMatchInput,
  models: readonly ModelInfo[] | undefined,
): ModelInfo | null {
  if (models === undefined) return null
  const id = model.id.trim()
  if (id.length === 0) return null
  const name = model.name?.trim() ?? ''
  const nameLower = name.toLowerCase()
  // ③ uses the literal transformation: vendor prefix dropped and `.` → `-`.
  const dashedId = stripIdPrefix(id).replace(/\./g, '-').toLowerCase()
  const normalizedName = normalizeName(stripVendorName(name))

  // ① exact id/slug, case-insensitive.
  for (const candidate of models) {
    if (candidate.slug.toLowerCase() === id.toLowerCase()) return candidate
  }
  // ② exact display name, case-insensitive.
  if (nameLower.length > 0) {
    for (const candidate of models) {
      if (candidate.name.toLowerCase() === nameLower) return candidate
    }
  }
  // ③ vendor-less, dash-normalized id against the slug.
  if (dashedId.length > 0) {
    for (const candidate of models) {
      if (candidate.slug.toLowerCase() === dashedId) return candidate
    }
  }
  // ④ vendor-prefix-stripped, normalized name equality.
  if (normalizedName.length > 0) {
    for (const candidate of models) {
      if (normalizeName(stripVendorName(candidate.name)) === normalizedName) return candidate
    }
  }
  return null
}

/**
 * The stored model-level association for one harness provider route + model
 * id, if any. Provider-level associations (empty `modelId`) are deliberately
 * not returned: model rows resolve through the provider match instead.
 */
export function findAssociation(
  associations: readonly ManualAssociation[],
  providerRoute: string,
  modelId: string,
): ManualAssociation | undefined {
  if (modelId.length === 0) return undefined
  return associations.find(
    (item) => item.providerRoute === providerRoute && item.modelId === modelId,
  )
}

/** Resolve the quote model an association points at, if the dataset has it. */
export function quoteForAssociation(
  association: ManualAssociation,
  byProvider: Readonly<Record<string, readonly ModelInfo[]>>,
): ModelInfo | null {
  const models = byProvider[association.quoteProvider]
  if (models === undefined) return null
  return models.find((model) => model.slug === association.quoteModelSlug) ?? null
}

/**
 * True for dataset providers that are subscription-style token/coding plans
 * (e.g. CodeBuddy, GitHub Copilot, TRAE, Qoder) instead of per-token API
 * products. They carry no per-token prices, so manual association must not
 * offer them.
 *
 * Classification: a provider whose types only include `coding_tool`. API
 * providers that ALSO power coding tools keep their `direct` type (OpenAI,
 * Anthropic, Google, …) and aggregators keep their `aggregator` type with
 * per-token resale prices (Cursor, OpenCode) — both stay selectable.
 */
export function isExcludedPlanProvider(provider: ProviderInfo): boolean {
  const types = provider.providerTypes ?? []
  if (types.includes('coding_tool') && !types.includes('direct') && !types.includes('aggregator')) {
    return true
  }
  const hay = `${provider.name} ${provider.slug}`.toLowerCase()
  return /token[\s-]?plan|coding[\s-]?plan/.test(hay)
}

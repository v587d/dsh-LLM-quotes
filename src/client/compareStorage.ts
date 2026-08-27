/**
 * Persist a target model's comparison selection in localStorage so a reopened
 * detail popup restores the previously chosen comparison models.
 *
 * Selection is keyed by the target model's identity (`providerSlug:sid`), so
 * each model keeps its own comparison set. Only a minimal sanity check is done
 * on load — the stored rows are replayed with their snapshot data.
 * @module dsh-llm-quotes/client/compareStorage
 */

import type { ModelInfo } from '../types.ts'

const STORAGE_PREFIX = 'llm-quotes-compare:'

function storageKey(targetKey: string): string {
  return `${STORAGE_PREFIX}${targetKey}`
}

/** A loose structural check that a stored entry looks like a ModelInfo. */
function isModelInfoLike(value: unknown): value is ModelInfo {
  if (typeof value !== 'object' || value === null) return false
  const model = value as Record<string, unknown>
  return typeof model.sid === 'string'
    && typeof model.slug === 'string'
    && typeof model.name === 'string'
    && typeof (model.provider as { slug?: unknown } | undefined)?.slug === 'string'
    && Array.isArray(model.prices)
}

/** Load the persisted comparison selection for one target model. */
export function loadCompareSelection(targetKey: string): ModelInfo[] {
  try {
    const raw = window.localStorage.getItem(storageKey(targetKey))
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isModelInfoLike)
  } catch {
    return []
  }
}

/** Persist the comparison selection for one target model. */
export function saveCompareSelection(targetKey: string, models: readonly ModelInfo[]): void {
  try {
    window.localStorage.setItem(storageKey(targetKey), JSON.stringify(models))
  } catch {
    // Storage unavailable (private mode etc.); the selection is session-only.
  }
}

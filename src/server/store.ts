/**
 * Local settings/associations store for dsh-llm-quotes.
 *
 * This is intentionally a thin wrapper over `~/.dsh/llm-quotes.json`.
 * All writes are atomic JSON file replacements.
 *
 * The watchlist (follow/pause/archive records with price history) lives in
 * its own JSONL file (`~/.dsh/watchlist.jsonl`) — see watchlist.ts.
 * @module dsh-llm-quotes/server/store
 */

import { loadStore, saveStore } from '../config.ts'
import type {
  AppSettings,
  ManualAssociation,
  SettingsResponse,
} from '../types.ts'

/** Local store operations. */
export class LlmQuotesStore {
  settings(): AppSettings {
    return loadStore().settings
  }

  updateSettings(partial: Partial<AppSettings>): SettingsResponse {
    const store = loadStore()
    const settings: AppSettings = {
      refreshMinutes: numberOr(partial.refreshMinutes, store.settings.refreshMinutes),
      compareLimit: clampInt(partial.compareLimit, 2, 10, store.settings.compareLimit),
    }
    saveStore({ ...store, settings })
    return { settings }
  }

  listAssociations(): readonly ManualAssociation[] {
    return loadStore().associations
  }

  /** Upsert one manual association (keyed by provider route + model id). */
  setAssociation(association: ManualAssociation): readonly ManualAssociation[] {
    const store = loadStore()
    const next = [
      ...store.associations.filter(
        (item) => !(item.providerRoute === association.providerRoute && item.modelId === association.modelId),
      ),
      association,
    ]
    saveStore({ ...store, associations: next })
    return next
  }

  /** Remove the association for one harness provider route + model id. */
  removeAssociation(providerRoute: string, modelId: string): readonly ManualAssociation[] {
    const store = loadStore()
    const next = store.associations.filter(
      (item) => !(item.providerRoute === providerRoute && item.modelId === modelId),
    )
    saveStore({ ...store, associations: next })
    return next
  }
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  return fallback
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}
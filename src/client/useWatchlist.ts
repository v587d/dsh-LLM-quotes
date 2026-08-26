/**
 * Watchlist state management for dsh-llm-quotes.
 *
 * Persists a set of composite keys (`providerSlug:modelSlug`) in localStorage.
 * The composite key ensures that models with the same name but different
 * providers are tracked independently (e.g., Deepseek vs OpenRouter).
 *
 * Clicking the star follows/unfollows: follow upserts an `active` record on
 * the host, unfollow pauses it (status `paused`) so its price history in the
 * host JSONL store survives for trend tracking. The star therefore shows
 * membership, while the host keeps the record either way.
 *
 * The host JSONL store is a durable mirror, not the source of truth for the
 * UI (localStorage is). On mount the hook hydrates from the host once:
 * records the host knows as `active` are added to the local set, records it
 * knows as paused/archived are removed from it, so a cleared localStorage or
 * a second browser converges with the host.
 * @module dsh-llm-quotes/client/useWatchlist
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { ModelInfo } from '../types.ts'
import type { LlmQuotesApi } from './index.ts'

/** localStorage key for the watchlist set. */
const STORAGE_KEY = 'llm-quotes-watchlist'

/**
 * Create a composite watchlist key from provider and model identifiers.
 * Format: `providerSlug:modelSlug`
 */
export function watchlistKey(providerSlug: string, modelSlug: string): string {
  return `${providerSlug}:${modelSlug}`
}

/** Read the current watchlist from localStorage. */
function readWatchlist(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((item): item is string => typeof item === 'string'))
  } catch {
    return new Set()
  }
}

/** Write the watchlist to localStorage. */
function writeWatchlist(keys: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    // Storage unavailable (private mode etc.); the watchlist is session-only.
  }
}

// Shared mutable state + subscription for useSyncExternalStore.
let currentSnapshot: ReadonlySet<string> = readWatchlist()
// Bumped by every local mutation; hydration merges only when no local
// mutation happened while the host fetch was in flight.
let mutationVersion = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function getSnapshot(): ReadonlySet<string> {
  return currentSnapshot
}

function notify(): void {
  for (const listener of listeners) listener()
}

/** Listen for cross-tab storage changes. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return
    currentSnapshot = readWatchlist()
    notify()
  })
}

/** Toggle one composite key in the shared watchlist and persist locally. */
function toggleKey(key: string): void {
  const next = new Set(currentSnapshot)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  currentSnapshot = next
  mutationVersion++
  writeWatchlist(next)
  notify()
}

/**
 * Merge the host JSONL records into the local set once.
 * `active` records are added; paused/archived records remove stale local
 * keys (e.g. an unfollow done in another browser). Skipped when a local
 * mutation happened while the fetch was in flight.
 */
async function hydrateFromHost(api: LlmQuotesApi): Promise<void> {
  let records: readonly { readonly key: string; readonly status: 'active' | 'paused' | 'archived' }[]
  try {
    records = await api.getWatchlist()
  } catch {
    return // Host unavailable; keep the local state.
  }
  const versionAtStart = mutationVersion
  if (mutationVersion !== versionAtStart) return
  const next = new Set(currentSnapshot)
  let changed = false
  for (const record of records) {
    if (record.status === 'active') {
      if (!next.has(record.key)) {
        next.add(record.key)
        changed = true
      }
    } else if (next.has(record.key)) {
      next.delete(record.key)
      changed = true
    }
  }
  if (!changed) return
  currentSnapshot = next
  writeWatchlist(next)
  notify()
}

/**
 * React hook: returns the watchlist set and a toggle function.
 *
 * Uses `useSyncExternalStore` so multiple components share one source of
 * truth without prop-drilling or context providers.
 *
 * When `api` is provided, toggling also syncs with the host-side JSONL
 * persistence: follow upserts (status `active`), unfollow pauses the record
 * so its price history survives. The `getModel` callback provides the full
 * ModelInfo for host-side upsert.
 */
export function useWatchlist(api?: LlmQuotesApi): {
  readonly watched: ReadonlySet<string>
  readonly toggle: (key: string, model?: ModelInfo, providerSlug?: string) => void
  readonly isWatched: (key: string) => boolean
} {
  const watched = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // One-shot hydration from the durable host store.
  useEffect(() => {
    if (api === undefined) return
    void hydrateFromHost(api)
  }, [api])

  const toggle = useCallback((key: string, model?: ModelInfo, providerSlug?: string) => {
    toggleKey(key)
    // Sync with host if API and model info are provided.
    if (api && model && providerSlug) {
      const isNowWatched = currentSnapshot.has(key)
      if (isNowWatched) {
        api.upsertWatchlist(model, providerSlug).catch(() => {
          // Ignore sync errors; localStorage is the source of truth for UI.
        })
      } else {
        // Unfollow keeps the record so its price history survives; the star
        // is off because the record is paused.
        api.updateWatchlistStatus(key, 'paused').catch(() => {
          // The record may never have reached the host (e.g. host was
          // unavailable when following); that is fine.
        })
      }
    }
  }, [api])
  const isWatched = useCallback((key: string) => watched.has(key), [watched])
  return { watched, toggle, isWatched }
}

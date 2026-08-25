/**
 * Local configuration and dataset persistence for dsh-llm-quotes.
 *
 * Two local files are used:
 * - `~/.dsh/llm-quotes.json` — user settings + model-level associations.
 * - `~/.dsh/llm-quotes-data.json` — the last successfully fetched LLMRates
 *   dataset snapshot (only written on success).
 *
 * All paths honour `$DSH_HOME` when set.
 * @module dsh-llm-quotes/config
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import type { DatasetSnapshot, StoreData, AppSettings } from './types.ts'

/**
 * Daily sync: the local dataset is refreshed at most once per calendar day
 * (the official dataset updates daily; LLMRates endpoints are edge-cached).
 * Kept in minutes for the legacy settings field; users who previously saved
 * a smaller value are simply treated as "already synced today".
 */
export const DEFAULT_REFRESH_MINUTES = 24 * 60
/** Default maximum number of models in a comparison. */
export const DEFAULT_COMPARE_LIMIT = 5

/** Resolve the DSH home directory ($DSH_HOME or ~/.dsh). */
export function dshHome(): string {
  const explicit = process.env.DSH_HOME
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  return join(homedir(), '.dsh')
}

/** User config file path. */
export function configFilePath(): string {
  return join(dshHome(), 'llm-quotes.json')
}

/** Dataset snapshot file path. */
export function dataFilePath(): string {
  return join(dshHome(), 'llm-quotes-data.json')
}

/** Default store used when no file exists yet. */
export function defaultStore(): StoreData {
  return {
    version: 1,
    settings: {
      refreshMinutes: DEFAULT_REFRESH_MINUTES,
      compareLimit: DEFAULT_COMPARE_LIMIT,
    },
    associations: [],
  }
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') return parsed as T
    return null
  } catch {
    return null
  }
}

function writeJson(path: string, value: unknown): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Best-effort; some platforms may not support chmod.
  }
}

/** Load the user store; falls back to defaults if missing/corrupt. Legacy
 * files that still carry `watch`/`alerts` arrays are tolerated: those fields
 * are simply ignored and dropped on the next write. */
export function loadStore(): StoreData {
  const file = readJson<Partial<StoreData>>(configFilePath())
  if (file === null) return defaultStore()
  const settings: AppSettings = {
    refreshMinutes: numberOr(file.settings?.refreshMinutes, DEFAULT_REFRESH_MINUTES),
    compareLimit: clampInt(file.settings?.compareLimit, 2, 10, DEFAULT_COMPARE_LIMIT),
  }
  return {
    version: 1,
    settings,
    associations: Array.isArray(file.associations) ? file.associations as StoreData['associations'] : [],
  }
}

/** Persist the user store. */
export function saveStore(store: StoreData): void {
  writeJson(configFilePath(), store)
}

/** Load the last successfully fetched dataset snapshot. */
export function loadDataSnapshot(): DatasetSnapshot | null {
  return readJson<DatasetSnapshot>(dataFilePath())
}

/** Persist a successful dataset snapshot. */
export function saveDataSnapshot(snapshot: DatasetSnapshot): void {
  writeJson(dataFilePath(), snapshot)
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  return fallback
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

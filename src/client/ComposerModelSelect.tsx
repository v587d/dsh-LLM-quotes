/**
 * Composer model seat (`conversation.input.model`) for dsh-llm-quotes.
 *
 * The shipped model selector is a `single` seat, so the only way to annotate
 * its menu rows is to take the seat and render the selector ourselves. This
 * component is a faithful port of the shipped `ModelSelect` (same two-level
 * menu, keyboard navigation, effort pane, toast) plus one addition: watched
 * models carry a price-change signal dot — red = price(s) up, green =
 * price(s) down, gray = watched but unchanged (or no comparison yet). Hover
 * shows a tooltip with the from → to details per field.
 *
 * Data: the per-session model directory is reused from the shared
 * `modelDirectories` service when the harness provides it (so the composer
 * seat and the `/model` popup stay in sync); otherwise a local equivalent is
 * built on the same session RPCs. Signals come from the watchlist JSONL
 * price history through the same-origin API.
 * @module dsh-llm-quotes/client/ComposerModelSelect
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconWarningOutline16,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConnectionHandle, ModelProviderGroup } from '@deepseek-ai/dsh-client-connection/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ManualAssociation,
  ModelInfo,
  PriceChangeResult,
  ProviderInfo,
  WatchlistRecord,
} from '../types.ts'
import {
  findAssociation,
  matchModelId,
  matchProviderRoute,
  quoteForAssociation,
} from './matching.ts'
import {
  loadProviderAssociations,
  providerAssociationsToManual,
} from './providerAssociations.ts'
import { formatDay, formatPrice } from './format.ts'
import { NS } from './locales.ts'
import { PRICE_FIELD_LABEL_KEYS, priceSignalOf, type PriceSignal } from './signals.ts'
import type { LlmQuotesApi } from './index.ts'
import css from './styles.module.css'

/**
 * The composer model seat is declared by dsh-client-ui-conversation at
 * runtime; this plugin declares the same shape locally (the package is not a
 * dependency of this repo) so registering an occupant type-checks.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.input.model': {
      kind: 'single'
      scope: 'session'
      owner: { locked: boolean }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Structural mirror of the harness model-directory contracts          */
/* ------------------------------------------------------------------ */

/** The directory state both the composer seat and the /model popup render. */
export interface ModelDirectoryState {
  current: ModelSelection | null
  routable: boolean | null
  groups: readonly ModelProviderGroup[]
  failures: readonly { id: string; name: string; message: string }[]
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  error: string | null
}

/** Selection shape submitted to the host. */
export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** The face injected into the composer model seat (shared or local). */
export interface ModelDirectoryFace {
  readonly store: {
    subscribe(fn: () => void): () => void
    getSnapshot(): ModelDirectoryState
  }
  load(): Promise<unknown>
  select(selection: ModelSelection): Promise<unknown>
}

/* ------------------------------------------------------------------ */
/* Signal data pipeline (module-level caches, one page load)           */
/* ------------------------------------------------------------------ */

let providersPromise: Promise<readonly ProviderInfo[]> | null = null
const modelsByProvider = new Map<string, Promise<Record<string, readonly ModelInfo[]>>>()

function quotesProviders(api: LlmQuotesApi): Promise<readonly ProviderInfo[]> {
  providersPromise ??= api.providers().catch(() => [])
  return providersPromise
}

function quotesProviderModels(api: LlmQuotesApi, slug: string): Promise<Record<string, readonly ModelInfo[]>> {
  let pending = modelsByProvider.get(slug)
  if (pending === undefined) {
    pending = api.providerModels([slug]).catch(() => ({}))
    modelsByProvider.set(slug, pending)
  }
  return pending
}

/**
 * Resolve every model row of the directory to a watchlist key and fetch its
 * signal. Returns a map `rowId → signal` where:
 * - `undefined` = the model is not currently watched (no `active` record) —
 *   no dot (unfollowed/paused models keep their history but stop signaling);
 * - `null` = watched but no comparison possible yet (single snapshot) — gray;
 * - `PriceSignal` = the derived direction — colored dot.
 */
export async function resolveModelSignals(
  api: LlmQuotesApi,
  groups: readonly ModelProviderGroup[],
  labelOf: (field: string) => string,
): Promise<Record<string, PriceSignal | null | undefined>> {
  if (groups.length === 0) return {}
  const [providers, hostAssociations, records] = await Promise.all([
    quotesProviders(api),
    api.associations(),
    api.getWatchlist(),
  ])
  const associations: readonly ManualAssociation[] = [
    ...hostAssociations,
    ...providerAssociationsToManual(loadProviderAssociations()),
  ]
  // Only `active` records signal: unfollowing pauses the record (history is
  // kept for trends) but the menu dot disappears.
  const watchedKeys = new Set(
    records
      .filter((record: WatchlistRecord) => record.status === 'active')
      .map((record: WatchlistRecord) => record.key),
  )

  const keys = new Set<string>()
  const byRow = new Map<string, string>()
  for (const group of groups) {
    const quoteProvider = matchProviderRoute(group.id, providers, associations)
    if (quoteProvider === null) continue
    const byProvider = await quotesProviderModels(api, quoteProvider)
    const models = byProvider[quoteProvider]
    for (const model of group.models) {
      const association = findAssociation(associations, group.id, model.id)
      const quote = association !== undefined
        ? quoteForAssociation(association, byProvider)
        : matchModelId({ id: model.id, name: model.name }, models)
      if (quote === null) continue
      const key = `${quoteProvider}:${quote.slug}`
      keys.add(key)
      byRow.set(`${group.id}/${model.id}`, key)
    }
  }
  if (byRow.size === 0) return {}

  const changes = await api.priceChanges([...keys])
  const out: Record<string, PriceSignal | null | undefined> = {}
  for (const [rowId, key] of byRow) {
    if (!watchedKeys.has(key)) continue
    const result = changes[key]
    out[rowId] = result === null || result === undefined
      ? null // watched but no comparison (single snapshot) → gray
      : priceSignalOf(result, labelOf)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Local model directory (fallback when the shared service is absent)  */
/* ------------------------------------------------------------------ */

interface SessionModelsRpc {
  models(request: { sessionId: string }): Promise<{ result: { ok: boolean; value: ModelDirectoryState; error?: { code: string; message: string } } }>
  selectModel(request: { sessionId: string; provider: string; model: string; reasoningEffort?: string }): Promise<{ result: { ok: boolean; value: { selected: ModelSelection }; error?: { code: string; message: string } } }>
}

const IDLE_DIRECTORY: ModelDirectoryState = {
  current: null,
  routable: null,
  groups: [],
  failures: [],
  status: 'idle',
  error: null,
}

/** Per-session directory backed directly by the session RPCs. */
export class LocalModelDirectory implements ModelDirectoryFace {
  readonly store = createLocalSnapshotStore<ModelDirectoryState>(IDLE_DIRECTORY)
  private generation = 0
  private disposed = false

  constructor(
    private readonly sessions: SessionModelsRpc | undefined,
    private readonly sessionId: string,
  ) {}

  dispose(): void {
    this.disposed = true
  }

  async load(): Promise<unknown> {
    if (this.sessions === undefined) {
      this.store.update((state) => { state.status = 'error'; state.error = 'connection unavailable' })
      throw new Error('connection unavailable')
    }
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'loading'; state.error = null })
    const response = await this.sessions.models({ sessionId: this.sessionId })
    if (this.disposed || generation !== this.generation) {
      if (response.result.ok) return response.result.value
      throw new Error(`${response.result.error?.code}: ${response.result.error?.message}`)
    }
    if (!response.result.ok) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = `${response.result.error?.code ?? 'unknown'}: ${response.result.error?.message ?? ''}`
      })
      throw new Error(`session.models failed: ${response.result.error?.code}: ${response.result.error?.message}`)
    }
    const value = response.result.value
    this.store.update((state) => {
      state.current = value.current
      state.routable = value.routable
      state.groups = value.groups
      state.failures = value.failures
      state.status = 'ready'
      state.error = null
    })
    return value
  }

  async select(selection: ModelSelection): Promise<unknown> {
    if (this.sessions === undefined) {
      this.store.update((state) => { state.status = 'error'; state.error = 'connection unavailable' })
      throw new Error('connection unavailable')
    }
    const generation = ++this.generation
    this.store.update((state) => { state.status = 'selecting'; state.error = null })
    const response = await this.sessions.selectModel({
      sessionId: this.sessionId,
      provider: selection.provider,
      model: selection.model,
      ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
    })
    if (this.disposed || generation !== this.generation) {
      if (response.result.ok) return response.result.value
      throw new Error(`${response.result.error?.code}: ${response.result.error?.message}`)
    }
    if (!response.result.ok) {
      this.store.update((state) => {
        state.status = 'error'
        state.error = `${response.result.error?.code ?? 'unknown'}: ${response.result.error?.message ?? ''}`
      })
      throw new Error(`session.selectModel failed: ${response.result.error?.code}: ${response.result.error?.message}`)
    }
    this.store.update((state) => {
      state.current = response.result.value.selected
      state.routable = true
      state.status = 'ready'
      state.error = null
    })
    return response.result.value
  }
}

/**
 * Resolve the session's model directory: prefer the harness's shared
 * `modelDirectories` service (the composer seat then stays in sync with the
 * `/model` popup); fall back to a local RPC-backed directory.
 */
export function resolveSessionDirectory(
  ctx: Pick<ClientContext, 'get'>,
  sessionId: string,
): ModelDirectoryFace {
  const shared = ctx.get('modelDirectories') as
    | { directoryFor?(sessionId: string): ModelDirectoryFace }
    | undefined
  if (typeof shared?.directoryFor === 'function') {
    try {
      return shared.directoryFor(sessionId)
    } catch {
      // Unknown session — fall through to the local directory.
    }
  }
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  return new LocalModelDirectory(connection?.api?.sessions as SessionModelsRpc | undefined, sessionId)
}

/** True when the session is an addressed subagent (model selection blocked). */
export function isSubagentSession(
  ctx: Pick<ClientContext, 'get'>,
  sessionId: string,
): boolean {
  const sessions = ctx.get('sessions') as { subagentAddress?(sessionId: string): unknown } | undefined
  try {
    return typeof sessions?.subagentAddress === 'function'
      && sessions.subagentAddress(sessionId) !== undefined
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* The composer model seat component                                   */
/* ------------------------------------------------------------------ */

/** Injected props (owner `locked` + this plugin's face). */
export interface ComposerModelSelectProps {
  readonly locked: boolean
  readonly available: boolean
  readonly directory: ModelDirectoryFace
  readonly load: () => void
  readonly select: (selection: ModelSelection) => Promise<boolean>
  readonly api: LlmQuotesApi
  readonly t: TranslateNS<typeof NS>
}

/** Tooltip payload: hovered row + the row's screen rect. */
interface TooltipAnchor {
  readonly key: string
  readonly rect: DOMRect
}

/** One effort menu row (provider default or an explicit effort level). */
interface EffortChoice {
  readonly key: string
  readonly effort: string | undefined
  readonly label: string
  readonly description?: string
}

/**
 * Minimal snapshot store with the same observable surface the harness
 * `SnapshotStore` has (subscribe/getSnapshot/update). Kept local so the
 * bundle needs no value import from `dsh-client-runtime` (its CJS factory
 * exports are not statically resolvable by the browser bundler).
 */
export interface LocalSnapshotStore<T> {
  subscribe(fn: () => void): () => void
  getSnapshot(): T
  update(mutator: (draft: T) => void): void
}

export function createLocalSnapshotStore<T>(init: T): LocalSnapshotStore<T> {
  let state = init
  const listeners = new Set<() => void>()
  return {
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    getSnapshot(): T {
      return state
    },
    update(mutator: (draft: T) => void): void {
      const draft = structuredClone(state)
      mutator(draft)
      state = draft
      for (const listener of listeners) listener()
    },
  }
}

/** Format one from → to value for the tooltip. */
function formatChange(value: number | null, currency: string): string {
  if (value === null) return '—'
  return formatPrice(value, currency)
}

/**
 * Render the composer model seat: trigger + two-level menu (Model/Effort)
 * with watchlist price-change signal dots on the model rows.
 */
export function ComposerModelSelect(props: ComposerModelSelectProps): ReactElement | null {
  const { locked, available, directory, load, select, api, t } = props
  const state = useSyncExternalStore(
    (fn: () => void) => directory.store.subscribe(fn),
    () => directory.store.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<'root' | 'model' | 'effort'>('root')
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])
  const id = useId()

  // Watchlist signals per directory row (`undefined` = not watched).
  const [signals, setSignals] = useState<Record<string, PriceSignal | null | undefined>>({})
  const [hover, setHover] = useState<TooltipAnchor | null>(null)

  const choices = useMemo(() => state.groups.flatMap((group) =>
    group.models.map((model) => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort },
      },
    })),
  ), [state.groups])

  const currentChoice = choices[state.current === null
    ? -1
    : choices.findIndex((c) =>
      c.selection.provider === state.current?.provider && c.selection.model === state.current.model)]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined ? undefined
    : effectiveEffort === undefined ? t('ms.effortDefault')
      : reasoning.efforts.find((level) => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<EffortChoice[]>(() => reasoning === undefined ? []
    : [
      ...(reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('ms.effortDefault') }]
        : []),
      ...reasoning.efforts.map((effort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
        description: effort.description,
      })),
    ], [reasoning, t])
  const busy = state.status === 'selecting'
  const reload = useCallback(() => {
    lastActionRef.current = 'load'
    load()
  }, [load])

  // Initial directory load.
  useEffect(() => {
    if (available) {
      lastActionRef.current = 'load'
      load()
    }
  }, [available, load])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  // Load signals whenever the model pane opens (fresh watchlist data).
  useEffect(() => {
    if (!open || pane !== 'model') return
    let cancelled = false
    resolveModelSignals(api, state.groups, (field) => t(PRICE_FIELD_LABEL_KEYS[field] ?? field))
      .then((result) => { if (!cancelled) setSignals(result) })
      .catch(() => { /* host unreachable — rows simply show no dots */ })
    return () => { cancelled = true }
  }, [open, pane, api, state.groups, t])

  if (!available) return null

  const show = (): void => {
    setPane('root')
    setOpen(true)
    setHover(null)
    reload()
  }
  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    setHover(null)
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus())
  }
  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter((item) => item !== null)
    if (items.length === 0) return
    const active = items.findIndex((item) => item === document.activeElement)
    items[(Math.max(active, 0) + offset + items.length) % items.length]?.focus()
  }
  const onRootKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }
  const onBlur = (event: ReactFocusEvent): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }
  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.store.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('ms.errorAction', { message }) })
    }
  }
  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    select(selection).then(settleSelection)
  }
  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    select(selection).then(settleSelection)
  }

  const modelLabel = currentChoice?.model.name ?? t('ms.fallback')
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = currentChoice === undefined ? t('ms.triggerSelectAria')
    : effortLabel === undefined ? t('ms.triggerAria', { model: modelLabel })
      : t('ms.triggerAriaEffort', { model: modelLabel, effort: effortLabel })

  itemRefs.current = []
  let itemIndex = 0
  const itemRef = (): ((node: HTMLElement | null) => void) => {
    const at = itemIndex++
    return (node: HTMLElement | null) => { itemRefs.current[at] = node }
  }

  const signalDot = (signal: PriceSignal | null | undefined): ReactElement | null => {
    if (signal === undefined) return null // not watched → no dot
    const cls = signal === null ? css.msDotNone
      : signal.direction === 'up' ? css.msDotUp
        : signal.direction === 'down' ? css.msDotDown
          : css.msDotNone
    return <span className={cls} aria-hidden="true" />
  }

  const hoveredSignal = hover === null ? undefined : signals[hover.key]

  return (
    <div
      ref={rootRef}
      className={css.msRoot}
      onKeyDown={onRootKeyDown}
      onBlur={onBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className={css.msTrigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => { if (open) close(); else show() }}
      >
        <span className={css.msTriggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.msTriggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutline14 className={clsx(css.msChevron, open && css.msChevronOpen)} />
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          className={css.msMenu}
          role="menu"
          aria-label={t('ms.menuAria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button
                ref={itemRef()}
                type="button"
                role="menuitem"
                className={css.msCell}
                onClick={() => setPane('model')}
              >
                <span className={css.msCellLabel}>{t('ms.menuModel')}</span>
                <span className={css.msCellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.msCellChevron} />
              </button>
              {reasoning !== undefined && (
                <button
                  ref={itemRef()}
                  type="button"
                  role="menuitem"
                  className={css.msCell}
                  onClick={() => setPane('effort')}
                >
                  <span className={css.msCellLabel}>{t('ms.menuEffort')}</span>
                  <span className={css.msCellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.msCellChevron} />
                </button>
              )}
            </>
          )}
          {pane === 'model' && (
            <>
              {state.status === 'loading' && <div className={css.msStatus}>{t('ms.loading')}</div>}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.msError}>
                  <span>{t('ms.errorAction', { message: state.error })}</span>
                  <button type="button" className={css.msRetry} onClick={reload}>{t('ms.retry')}</button>
                </div>
              )}
              {state.failures.map((failure) => (
                <div className={css.msWarning} key={failure.id}>
                  <span>{t('ms.warningGroup', { name: failure.name, message: failure.message })}</span>
                  <button type="button" className={css.msRetry} onClick={reload}>{t('ms.retry')}</button>
                </div>
              ))}
              <div className={clsx(css.msGroups, 'scrollable')}>
                {state.groups.map((group) => {
                  const headingId = `${id}-${group.id}`
                  return (
                    <section role="group" aria-labelledby={headingId} className={css.msGroup} key={group.id}>
                      <div className={css.msGroupTitle} id={headingId}>{group.name}</div>
                      {group.models.map((model) => {
                        const selected = state.current !== null
                          && state.current.provider === group.id
                          && state.current.model === model.id
                        const rowId = `${group.id}/${model.id}`
                        const signal = signals[rowId]
                        return (
                          <button
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={clsx(css.msOption, selected && css.msSelected)}
                            disabled={busy}
                            key={model.id}
                            onClick={() => choose({ provider: group.id, model: model.id })}
                          >
                            {/* Native title lives on the name column only, so
                                hovering the signal dot shows the custom price
                                tooltip without also firing the browser title. */}
                            <span className={css.msOptionCopy} title={model.name}>
                              <span className={css.msModelName}>{model.name}</span>
                              {model.description !== undefined && (
                                <span className={css.msDescription}>{model.description}</span>
                              )}
                            </span>
                            <span
                              className={css.msSignalSlot}
                              onMouseEnter={(event) => {
                                if (signal !== undefined) {
                                  setHover({ key: rowId, rect: event.currentTarget.getBoundingClientRect() })
                                }
                              }}
                              onMouseLeave={() => setHover((current) => current?.key === rowId ? null : current)}
                            >
                              {signalDot(signal)}
                            </span>
                            <span className={css.msCheck}>
                              {selected ? <IconCheckOutline16 /> : null}
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  )
                })}
              </div>
              {state.status === 'ready' && choices.length === 0 && (
                <div className={css.msEmpty}>{t('ms.emptyModels')}</div>
              )}
            </>
          )}
          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.msError}>
                  <span>{t('ms.errorAction', { message: state.error })}</span>
                  <button type="button" className={css.msRetry} onClick={reload}>{t('ms.retry')}</button>
                </div>
              )}
              {effortChoices.length === 0 ? (
                <div className={css.msEmpty}>{t('ms.emptyEfforts')}</div>
              ) : effortChoices.map((level) => (
                <button
                  ref={itemRef()}
                  type="button"
                  role="menuitemradio"
                  aria-checked={effectiveEffort === level.effort}
                  className={clsx(css.msOption, effectiveEffort === level.effort && css.msSelected)}
                  disabled={busy}
                  key={level.key}
                  onClick={() => chooseEffort(level.effort)}
                >
                  <span className={css.msOptionCopy}>
                    <span className={css.msModelName}>{level.label}</span>
                    {level.description !== undefined && (
                      <span className={css.msDescription}>{level.description}</span>
                    )}
                  </span>
                  <span className={css.msCheck}>
                    {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest('[data-composer-card]') ?? null}
          onDone={() => setToast(null)}
        />
      )}
      {hoveredSignal !== undefined && hover !== null && (
        <SignalTooltip anchor={hover.rect} signal={hoveredSignal} t={t} />
      )}
    </div>
  )
}

/** The hover tooltip: fixed-positioned portal above the row. */
function SignalTooltip({
  anchor,
  signal,
  t,
}: {
  anchor: DOMRect
  signal: PriceSignal | null
  t: TranslateNS<typeof NS>
}): ReactElement {
  const top = Math.max(8, anchor.top - 8)
  const header = signal === null ? t('ms.signalNone')
    : signal.direction === 'up' ? t('ms.signalUp')
      : signal.direction === 'down' ? t('ms.signalDown')
        : t('ms.signalNone')
  return createPortal(
    <div className={css.msTooltip} role="tooltip" style={{ top, left: anchor.left }}>
      <div className={css.msTooltipHeader}>{header}</div>
      {signal !== null && (
        <>
          <div className={css.msTooltipRange}>
            {formatDay(signal.fromTime)} → {formatDay(signal.toTime)}
          </div>
          {signal.currencyChanged ? (
            <div className={css.msTooltipRow}>{t('ms.currencyChanged')}</div>
          ) : signal.fields.length === 0 ? (
            <div className={css.msTooltipRow}>{t('ms.noChange')}</div>
          ) : signal.fields.map((field) => (
            <div className={css.msTooltipRow} key={field.label}>
              <span className={css.msTooltipLabel}>{field.label}</span>
              <span className={css.msTooltipValue}>
                {formatChange(field.old, signal.currency)} → {formatChange(field.new, signal.currency)}
              </span>
            </div>
          ))}
        </>
      )}
    </div>,
    document.body,
  )
}

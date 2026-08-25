/**
 * Settings → Models per-provider quote blocks for dsh-llm-quotes.
 *
 * The shipped Models section (dsh-client-ui-settings-models) has no
 * per-provider slot, so this occupant of `settings.action` renders nothing
 * itself and injects one quote block under each provider card through React
 * portals: it watches the settings dialog's DOM, anchors a container into
 * every provider card, and portals a per-card block into it.
 *
 * Each block shows the configured provider's models with their latest input
 * and output prices plus a Details popup carrying every valued model-level
 * field. There is no separate Watch step: successfully configured models are
 * implicitly watched. Provider matching is association-first (provider-level
 * manual association), then exact slug, then built-in alias; models then
 * match by slug/name, with a per-model manual association kept as the last
 * resort.
 *
 * Manual association is always a modal with a flat, single-select list:
 * - provider level: pick one quotes provider only (token/coding plans are
 *   shown disabled and out of scope);
 * - model level: pick one quotes model of the already-matched provider.
 * An unmatched provider shows no model list at all.
 * @module dsh-llm-quotes/client/SettingsModelsQuotes
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Translate, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ManualAssociation,
  ModelInfo,
  PriceInfo,
} from '../types.ts'
import type { LlmQuotesApi } from './index.ts'
import { NS } from './locales.ts'
import {
  findAssociation,
  findProviderAssociation,
  matchModelId,
  matchProviderRoute,
  quoteForAssociation,
} from './matching.ts'
import { formatContext, formatDay, formatPrice, pickDisplayPrice } from './format.ts'
import { ModelPickerModal, ProviderPickerModal } from './AssociationPickers.tsx'
import { ModelDetailModal } from './ModelDetailModal.tsx'
import { findModelsSection, providerCardsOf } from './modelsSectionDom.ts'
import { useQuotesData, type QuotesDataState } from './useQuotesData.ts'
import css from './styles.module.css'

/** Props for the injector: the injected translate faces + the quotes API. */
export interface SettingsModelsQuotesProps {
  t: TranslateNS<typeof NS>
  /** Translate bound to the settings.models namespace (Models section title). */
  tModels: Translate
  api: LlmQuotesApi
}

/** One anchored provider card: the card element + the portal container. */
interface CardState {
  readonly li: HTMLLIElement
  readonly anchor: HTMLDivElement
  readonly displayName: string
  /** Stable portal key (React keys cannot be DOM nodes). */
  readonly key: string
}

/** A manual-association editor in progress. */
interface PickerState {
  /** Harness provider route the association belongs to. */
  readonly route: string
  /** Harness model id; '' = provider-level association. */
  readonly modelId: string
}

/** One modality shown per model: the single modality itself, or `MM` for
 * multi-modal models (hover reveals the full modality list). */
function ModalityTags({ modalities }: { modalities: readonly string[] }) {
  if (modalities.length === 0) return null
  const label = modalities.length === 1 ? modalities[0] : 'MM'
  return (
    <span className={css.sqMods} title={modalities.join(', ')}>
      <span className={css.sqModTag}>{label}</span>
    </span>
  )
}

/**
 * Inject one quote block under every provider card of the Models section
 * while the settings panel is open. Mounts as a `settings.action` occupant.
 */
export function SettingsModelsQuotes({ t, api, tModels }: SettingsModelsQuotesProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const anchorsRef = useRef(new Map<HTMLLIElement, HTMLDivElement>())
  const [cards, setCards] = useState<readonly CardState[]>([])
  const quotes = useQuotesData(api)
  const modelsTitle = tModels('title')
  const sectionSeen = useRef(false)
  const nextCardKey = useRef(0)

  /** Rescan the settings dialog and sync anchors/portals to the live cards. */
  const scan = useCallback((): void => {
    const root = rootRef.current
    if (root === null) return
    const anchors = anchorsRef.current
    const section = findModelsSection(root, modelsTitle)
    if (section === null) {
      sectionSeen.current = false
      for (const [li] of anchors) {
        if (!li.isConnected) anchors.delete(li)
      }
      setCards((prev) => (prev.length === 0 ? prev : []))
      return
    }
    // Re-enter the Models section → refresh the harness snapshot (the user may
    // have added/removed providers while settings stayed open).
    if (!sectionSeen.current) {
      sectionSeen.current = true
      quotes.reload()
    }
    for (const [li] of anchors) {
      if (!li.isConnected) anchors.delete(li)
    }
    const next: CardState[] = []
    for (const card of providerCardsOf(section)) {
      let anchor = anchors.get(card.li)
      let key = anchor?.dataset.llmQuotesKey
      if (anchor === undefined) {
        anchor = document.createElement('div')
        // order: 1 keeps the quotes block above the harness's Edit editor
        // (the card li is a flex column; the editor is appended after our
        // anchor and stays at the default order 0).
        anchor.className = css.sqAnchor
        anchor.dataset.llmQuotesAnchor = 'true'
        anchor.dataset.llmQuotesKey = `card-${nextCardKey.current++}`
        card.li.appendChild(anchor)
        anchors.set(card.li, anchor)
        key = anchor.dataset.llmQuotesKey
      }
      next.push({ li: card.li, anchor, displayName: card.displayName, key: key ?? `card-${nextCardKey.current++}` })
    }
    setCards((prev) => {
      if (prev.length === next.length && prev.every((item, i) => item.li === next[i].li && item.displayName === next[i].displayName)) {
        return prev
      }
      return next
    })
  }, [modelsTitle, quotes.reload])

  const scanRef = useRef(scan)
  useEffect(() => {
    scanRef.current = scan
  }, [scan])

  useEffect(() => {
    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(() => scanRef.current())
    })
    observer.observe(document.body, { childList: true, subtree: true })
    scanRef.current()
    return () => observer.disconnect()
  }, [])

  // New cards can appear while the panel stays open (the harness's own
  // "Add Provider" flow): the quotes snapshot was taken on entry, so the
  // added provider's card would otherwise show "Loading quotes…" forever.
  // When a card's display name is missing from the loaded snapshot, reload
  // once; the guard only retriggers when the unknown-name set changes, so a
  // provider that never resolves does not cause a reload loop. Runs before
  // paint so the block never flashes a wrong hint for that card.
  const unknownCardsRef = useRef('')
  useLayoutEffect(() => {
    if (quotes.configured === null || quotes.loading) return
    const configuredNames = new Set(quotes.configured.map((item) => item.displayName))
    const unknownKey = cards
      .map((card) => card.displayName)
      .filter((name) => !configuredNames.has(name))
      .sort()
      .join('|')
    if (unknownKey.length === 0) {
      unknownCardsRef.current = ''
      return
    }
    if (unknownCardsRef.current !== unknownKey) {
      unknownCardsRef.current = unknownKey
      quotes.reload()
    }
  }, [cards, quotes.configured, quotes.loading, quotes.reload])

  return (
    <div ref={rootRef} className={css.sqRoot} data-testid="llm-quotes-settings">
      {cards.map((card) => createPortal(
        <ProviderQuoteBlock
          key={card.key}
          t={t}
          quotes={quotes}
          displayName={card.displayName}
        />,
        card.anchor,
      ))}
    </div>
  )
}

/** localStorage key: per-provider-route collapse preference for the
 * "quotes extra" (dataset-only) rows. */
const DATA_ONLY_COLLAPSED_KEY = 'llm-quotes.data-only-collapsed'

/** Read the route → collapsed map ({} when empty/unavailable). */
function loadDataOnlyCollapsed(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(DATA_ONLY_COLLAPSED_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [route, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (route.length > 0 && typeof value === 'boolean') out[route] = value
    }
    return out
  } catch {
    return {}
  }
}

/** Persist one route's collapse preference. */
function saveDataOnlyCollapsed(route: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(
      DATA_ONLY_COLLAPSED_KEY,
      JSON.stringify({ ...loadDataOnlyCollapsed(), [route]: collapsed }),
    )
  } catch {
    // Storage unavailable (private mode etc.); the preference is session-only.
  }
}

/** One resolved row of a provider's quote block. */
interface QuoteRow {
  readonly ref: { id: string; explicit: boolean; name?: string | null }
  readonly quote: ModelInfo | null
  readonly association: ManualAssociation | undefined
  /** The price row the table shows (CNY preferred); undefined when unmatched. */
  readonly displayPrice: PriceInfo | undefined
  /** True for dataset-only models with no harness counterpart (quotes extra). */
  readonly dataOnly?: boolean
}

/** Sortable numeric columns. */
type SortKey = 'input' | 'output' | 'ctx'

/** Current column sort; null = no sort (harness order). */
interface SortState {
  readonly key: SortKey
  readonly dir: 1 | -1
}

/** The numeric value a row sorts/compares by; null sorts last always. */
function sortValueOf(row: QuoteRow, key: SortKey): number | null {
  if (row.quote === null) return null
  if (key === 'ctx') return row.quote.contextWindow ?? null
  if (key === 'input') return row.displayPrice?.inputPricePerMillion ?? null
  return row.displayPrice?.outputPricePerMillion ?? null
}

export interface ProviderQuoteBlockProps {
  t: TranslateNS<typeof NS>
  quotes: QuotesDataState
  /** Display name of the harness provider this card represents. */
  displayName: string
}

/** The quote block rendered under one provider card. */
export function ProviderQuoteBlock({ t, quotes, displayName }: ProviderQuoteBlockProps) {
  const [picker, setPicker] = useState<PickerState | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [detailModel, setDetailModel] = useState<ModelInfo | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [hideAllModels, setHideAllModels] = useState(false)
  const optionsRef = useRef<HTMLDivElement>(null)

  // Close the Options dropdown on outside click / Escape.
  useEffect(() => {
    if (!optionsOpen) return
    const onDown = (event: MouseEvent): void => {
      if (optionsRef.current !== null && !optionsRef.current.contains(event.target as Node)) {
        setOptionsOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOptionsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [optionsOpen])

  const provider = quotes.configured === null
    ? undefined
    : quotes.configured.find((item) => item.displayName === displayName)
  const route = provider?.route ?? ''
  const matchedSlug = provider === undefined
    ? null
    : matchProviderRoute(provider.route, quotes.quotesProviders, quotes.associations)
  const providerAssociation = provider === undefined
    ? undefined
    : findProviderAssociation(quotes.associations, provider.route)
  const providerModels = matchedSlug === null ? undefined : quotes.byProvider[matchedSlug]

  const rows: QuoteRow[] = provider === undefined ? [] : provider.models.map((ref) => {
    const association = findAssociation(quotes.associations, provider.route, ref.id)
    let quote: ModelInfo | null = null
    if (association !== undefined) {
      quote = quoteForAssociation(association, quotes.byProvider)
    } else if (providerModels !== undefined) {
      quote = matchModelId({ id: ref.id, name: ref.name }, providerModels)
    }
    // Prefer showing a CNY price row, then USD, then any other currency.
    const displayPrice = quote === null ? undefined : (pickDisplayPrice(quote.prices) ?? quote.price)
    return { ref, quote, association, displayPrice }
  })
  const unmatchedCount = rows.filter((row) => row.quote === null).length
  const matchedCount = rows.length - unmatchedCount
  const [showNotFound, setShowNotFound] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState | null>(null)
  const [dataOnlyCollapsed, setDataOnlyCollapsed] = useState<boolean>(
    () => route.length > 0 ? (loadDataOnlyCollapsed()[route] ?? false) : false,
  )

  // Dataset models that the harness catalog does not include at all: they
  // have no harness row, so they are appended as "quotes extra" rows. A
  // model is only extra when no harness row currently resolves to it.
  const matchedSlugs = useMemo(
    () => new Set(rows.filter((row) => row.quote !== null).map((row) => row.quote!.slug)),
    [rows],
  )
  const dataOnlyRows: QuoteRow[] = useMemo(() => {
    if (providerModels === undefined) return []
    return providerModels
      .filter((model) => !matchedSlugs.has(model.slug))
      .map((model) => ({
        ref: { id: model.slug, name: model.name, explicit: false },
        quote: model,
        association: undefined,
        displayPrice: pickDisplayPrice(model.prices) ?? model.price,
        dataOnly: true,
      }))
  }, [providerModels, matchedSlugs])
  const dataOnlyCount = dataOnlyRows.length
  const totalCount = rows.length + dataOnlyCount
  // Distinct dataset models covered by harness rows (two harness ids may
  // resolve to the same model), so the stats reconcile with the dataset.
  const matchedSlugCount = matchedSlugs.size

  const updateDataOnlyCollapsed = useCallback((collapsed: boolean): void => {
    setDataOnlyCollapsed(collapsed)
    if (route.length > 0) saveDataOnlyCollapsed(route, collapsed)
  }, [route])

  // Any search or sort resets every collapse/hide state back to the default
  // fully-expanded view so the whole union can be browsed.
  const resetExpansion = useCallback((): void => {
    setShowNotFound(true)
    setHideAllModels(false)
    setDataOnlyCollapsed(false)
  }, [])

  // Union list: harness rows (matched first, then not-found) plus the
  // dataset-only rows. Search filters everything; sorting re-orders every
  // priced row (matched + quotes extra) together, not-found rows stay at
  // the bottom.
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matchesQuery = (row: QuoteRow): boolean =>
      q.length === 0 || (row.quote?.name ?? row.ref.name ?? row.ref.id).toLowerCase().includes(q)
    const harnessMatched = rows.filter((row) => row.quote !== null && matchesQuery(row))
    const harnessUnmatched = rows.filter((row) => row.quote === null && matchesQuery(row) && showNotFound)
    const extras = dataOnlyRows.filter((row) => matchesQuery(row) && !dataOnlyCollapsed)
    if (sort !== null) {
      const priced = [...harnessMatched, ...extras]
      priced.sort((a, b) => {
        const x = sortValueOf(a, sort.key)
        const y = sortValueOf(b, sort.key)
        if (x === null) return 1
        if (y === null) return -1
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
      })
      return [...priced, ...harnessUnmatched]
    }
    return [...harnessMatched, ...harnessUnmatched, ...extras]
  }, [rows, dataOnlyRows, showNotFound, dataOnlyCollapsed, query, sort])

  const flashSaved = useCallback((): void => {
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 1500)
  }, [])

  const saveProviderAssociation = useCallback((quoteProvider: string): void => {
    if (route.length === 0 || quoteProvider.length === 0) return
    quotes.setProviderAssociation(route, quoteProvider)
      .then(() => {
        setPicker(null)
        flashSaved()
      }, () => {
        // Keep the editor open on failure.
      })
  }, [route, quotes, flashSaved])

  const saveModelAssociation = useCallback((quoteProvider: string, quoteModelSlug: string): void => {
    if (picker === null || quoteProvider.length === 0 || quoteModelSlug.length === 0) return
    quotes.setAssociation({
      providerRoute: picker.route,
      modelId: picker.modelId,
      quoteProvider,
      quoteModelSlug,
    }).then(() => {
      setPicker(null)
      flashSaved()
    }, () => {
      // Keep the editor open on failure.
    })
  }, [picker, quotes, flashSaved])

  const unlinkProviderAssociation = useCallback((): void => {
    if (route.length === 0) return
    quotes.removeProviderAssociation(route).then(() => {
      flashSaved()
    }, () => {
      // Ignore.
    })
  }, [route, quotes, flashSaved])

  const unlinkModelAssociation = useCallback((modelId: string): void => {
    quotes.removeAssociation(route, modelId).then(() => {
      flashSaved()
    }, () => {
      // Ignore.
    })
  }, [route, quotes, flashSaved])

  // NOTE: every hook must stay above the conditional returns below — React
  // counts hooks per render, and the early returns (loading/error states)
  // skip the rest of the component.
  const toggleSort = useCallback((key: SortKey): void => {
    resetExpansion()
    setSort((prev) => (prev !== null && prev.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  }, [resetExpansion])

  if (quotes.error !== null && provider === undefined) {
    return (
      <div className={css.sqBlock} data-testid="llm-quotes-provider-block">
        <div className={css.sqError}>{t('sq.error', { message: quotes.error })}</div>
        <button type="button" className={css.button} onClick={() => quotes.reload()}>
          {t('sq.retry')}
        </button>
      </div>
    )
  }

  if (provider === undefined || route.length === 0) {
    // In-flight load → keep the loading hint; a settled snapshot that still
    // misses this card (rare) shows a quiet hint instead of loading forever.
    const settled = quotes.configured !== null && !quotes.loading && quotes.error === null
    return (
      <div className={css.sqBlock} data-testid="llm-quotes-provider-block">
        <div className={css.sqHint}>{settled ? t('sq.noQuotes') : t('sq.loading')}</div>
      </div>
    )
  }

  const quoteReady = matchedSlug === null || providerModels !== undefined || quotes.loading === false
  const showEmpty = matchedSlug !== null && providerModels !== undefined && providerModels.length === 0
  const pickerAssociation = picker === null || picker.modelId.length === 0
    ? undefined
    : findAssociation(quotes.associations, picker.route, picker.modelId)

  const sortIndicator = (key: SortKey): string => {
    if (sort === null || sort.key !== key) return ''
    return sort.dir === 1 ? ' ▲' : ' ▼'
  }

  // Update date: prefer the source `Last-Modified` (dataset update date),
  // falling back to the local fetch time.
  const statsDate = quotes.meta === null ? '—' : formatDay(quotes.meta.updatedAt ?? quotes.meta.fetchedAt)
  const statsTitle = quotes.meta === null || quotes.meta.updatedAt === null
    ? undefined
    : quotes.meta.updatedAt

  const optionsEl = (
    <div className={css.optionsWrap} ref={optionsRef}>
      <button
        type="button"
        className={css.primaryButton}
        aria-expanded={optionsOpen}
        onClick={() => setOptionsOpen((open) => !open)}
      >
        {t('sq.options')}
      </button>
      {optionsOpen && (
        <div className={css.optionsMenu}>
          {matchedSlug !== null && unmatchedCount > 0 && (
            <button
              type="button"
              className={css.optionsItem}
              onClick={() => {
                setShowNotFound((visible) => !visible)
                setOptionsOpen(false)
              }}
            >
              {showNotFound ? t('sq.hideNotFound') : t('sq.showNotFound', { count: unmatchedCount })}
            </button>
          )}
          {matchedSlug !== null && dataOnlyCount > 0 && (
            <button
              type="button"
              className={css.optionsItem}
              onClick={() => {
                updateDataOnlyCollapsed(!dataOnlyCollapsed)
                setOptionsOpen(false)
              }}
            >
              {dataOnlyCollapsed
                ? t('sq.expandExtra', { count: dataOnlyCount })
                : t('sq.collapseExtra', { count: dataOnlyCount })}
            </button>
          )}
          {matchedSlug !== null && matchedCount > 0 && (
            <button
              type="button"
              className={css.optionsItem}
              onClick={() => {
                setHideAllModels((hidden) => !hidden)
                setOptionsOpen(false)
              }}
            >
              {hideAllModels ? t('sq.showAllAssociated') : t('sq.hideAllModels')}
            </button>
          )}
          {matchedSlug === null ? (
            <button
              type="button"
              className={css.optionsItem}
              onClick={() => {
                setPicker({ route, modelId: '' })
                setOptionsOpen(false)
              }}
            >
              {t('sq.associate')}
            </button>
          ) : (
            <>
              {providerAssociation !== undefined && (
                <button
                  type="button"
                  className={css.optionsItem}
                  onClick={() => {
                    unlinkProviderAssociation()
                    setOptionsOpen(false)
                  }}
                >
                  {t('sq.unlink')}
                </button>
              )}
              <button
                type="button"
                className={css.optionsItem}
                onClick={() => {
                  setPicker({ route, modelId: '' })
                  setOptionsOpen(false)
                }}
              >
                {t('sq.change')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className={css.sqBlock} data-testid="llm-quotes-provider-block">
      <div className={css.sqHeader}>
        {/* First row: title + match badge + status + union stats (with the
            dataset update date). Options sits here only when unmatched. */}
        <div className={css.sqHeaderTop}>
          <span className={css.sqTitle}>{t('sq.title')}</span>
          {matchedSlug !== null
            ? <span className={css.watchBadgeMatched}>{matchedSlug}</span>
            : <span className={css.watchBadgeUnmatched}>{t('sq.unmatched')}</span>}
          {!provider.active && <span className={css.watchBadgeInactive}>{t('sq.inactive')}</span>}
          {savedFlash && <span className={css.saved}>{t('sq.saved')}</span>}
          {matchedSlug !== null && (
            <span className={css.sqStats} title={statsTitle}>
              {t('sq.stats', {
                total: totalCount,
                matched: matchedSlugCount,
                notFound: unmatchedCount,
                extra: dataOnlyCount,
                date: statsDate,
              })}
            </span>
          )}
          {matchedSlug === null && (
            <span className={css.sqHeaderActions}>{optionsEl}</span>
          )}
        </div>
        {/* Second row (matched only): model-name search left, Options right. */}
        {matchedSlug !== null && (
          <div className={css.sqSearchRow}>
            <input
              type="search"
              className={css.sqSearch}
              placeholder={t('sq.searchPlaceholder')}
              value={query}
              onChange={(event) => {
                resetExpansion()
                setQuery(event.target.value)
              }}
              aria-label={t('sq.searchPlaceholder')}
            />
            <span className={css.sqHeaderActions}>{optionsEl}</span>
          </div>
        )}
      </div>

      {picker !== null && picker.modelId.length === 0 && (
        <ProviderPickerModal
          t={t}
          providers={quotes.quotesProviders}
          initial={providerAssociation?.quoteProvider ?? matchedSlug ?? ''}
          forProvider={provider.displayName}
          onSave={saveProviderAssociation}
          onCancel={() => setPicker(null)}
        />
      )}

      {/* An unmatched provider has no usable model list — showing one would
          only be a wall of "not found" rows, so no table is rendered. */}
      {matchedSlug !== null && (
        !quoteReady ? (
          <div className={css.sqHint}>{t('sq.loading')}</div>
        ) : showEmpty ? (
          <div className={css.sqHint}>{t('sq.noQuotes')}</div>
        ) : hideAllModels ? (
          <div className={css.sqHint}>{t('sq.modelsHidden')}</div>
        ) : (
          <div className={css.sqTableWrap}>
            {visibleRows.length === 0 ? (
              <div className={css.sqHint}>
                {query.trim().length > 0 ? t('sq.noMatch') : t('sq.noQuotes')}
              </div>
            ) : (
              <table className={css.sqTable}>
                <thead>
                  <tr>
                    <th>{t('panel.model')}</th>
                    <th className={css.sqSortableTh} onClick={() => toggleSort('input')}>
                      {t('panel.input')}{sortIndicator('input')}
                    </th>
                    <th className={css.sqSortableTh} onClick={() => toggleSort('output')}>
                      {t('panel.output')}{sortIndicator('output')}
                    </th>
                    <th className={css.sqSortableTh} onClick={() => toggleSort('ctx')}>
                      {t('panel.ctx')}{sortIndicator('ctx')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => {
                    if (row.quote === null) {
                      return (
                        <tr key={row.ref.id} className={css.sqUnmatchedRow}>
                          <td>
                            <span className={css.modelName}>{row.ref.name ?? row.ref.id}</span>
                            <span className={css.watchBadgeUnmatched}>{t('sq.notFound')}</span>
                          </td>
                          <td colSpan={3}>
                            {row.association !== undefined ? (
                              <button
                                type="button"
                                className={css.linkButton}
                                onClick={() => unlinkModelAssociation(row.ref.id)}
                              >
                                {t('sq.unlink')}
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={css.primaryButton}
                                onClick={() => setPicker({ route, modelId: row.ref.id })}
                              >
                                {t('sq.associateModel')}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    }
                    const displayPrice = row.displayPrice ?? row.quote.price
                    if (row.dataOnly === true) {
                      // Dataset-only rows: lighter model name + "quotes extra"
                      // tag; they are already the price source, so no manual
                      // association action (unlike the harness not-found rows).
                      return (
                        <tr
                          key={`extra-${row.ref.id}`}
                          className={css.sqClickableRow}
                          title={t('sq.detail')}
                          onClick={() => setDetailModel(row.quote)}
                        >
                          <td>
                            <span className={css.sqDataOnlyName}>{row.quote.name}</span>
                            <span className={css.sqDataOnlyBadge}>{t('sq.quotesExtra')}</span>
                            {row.quote.modalities.length > 0 && <ModalityTags modalities={row.quote.modalities} />}
                          </td>
                          <td>{formatPrice(displayPrice.inputPricePerMillion, displayPrice.priceUnit)}</td>
                          <td>{formatPrice(displayPrice.outputPricePerMillion, displayPrice.priceUnit)}</td>
                          <td>{formatContext(row.quote.contextWindow)}</td>
                        </tr>
                      )
                    }
                    return (
                      <tr
                        key={row.ref.id}
                        className={css.sqClickableRow}
                        title={t('sq.detail')}
                        onClick={() => setDetailModel(row.quote)}
                      >
                        <td>
                          <span className={css.modelName}>{row.quote.name}</span>
                          {row.quote.modalities.length > 0 && <ModalityTags modalities={row.quote.modalities} />}
                        </td>
                        <td>{formatPrice(displayPrice.inputPricePerMillion, displayPrice.priceUnit)}</td>
                        <td>{formatPrice(displayPrice.outputPricePerMillion, displayPrice.priceUnit)}</td>
                        <td>{formatContext(row.quote.contextWindow)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )
      )}

      {picker !== null && picker.modelId.length > 0 && matchedSlug !== null && providerModels !== undefined && (
        <ModelPickerModal
          t={t}
          models={providerModels}
          initial={pickerAssociation?.quoteModelSlug ?? ''}
          forModel={rows.find((row) => row.ref.id === picker.modelId)?.ref.name ?? picker.modelId}
          onSave={(quoteModelSlug) => saveModelAssociation(matchedSlug, quoteModelSlug)}
          onCancel={() => setPicker(null)}
        />
      )}

      {detailModel !== null && (
        <ModelDetailModal t={t} model={detailModel} onClose={() => setDetailModel(null)} />
      )}
    </div>
  )
}

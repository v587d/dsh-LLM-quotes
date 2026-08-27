/**
 * Model detail popup: shows every model-level field of a quotes model that
 * has a value — model attributes plus all valued price-row fields — in a
 * clean sectioned modal. Shared by the Settings → Models quote blocks and
 * the prices panel.
 *
 * A "compare" dropdown sits in the header (when the quotes API is available):
 * it opens a provider tree whose providers lazily load their model lists on
 * expand (each provider node is disabled while loading), and checking models
 * builds a comparison table at the top of the modal. The table uses the target
 * model's field set as its rows — the target is the first column and each
 * selected model a further column, with missing values shown as the NA
 * placeholder. Prices are normalized to the target's currency when FX rates
 * are available; the standout value of each row (max for capacity, min for
 * price) is highlighted. Up to COMPARE_MAX models can be added; the selection
 * is keyed by the target model and persisted to localStorage so a reopened
 * popup restores it.
 *
 * Boolean support flags are shown always (true/false), other fields only
 * when they carry a value, matching the "所有有值字段" requirement.
 * @module dsh-llm-quotes/client/ModelDetailModal
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FxResponse, ModelInfo, PriceInfo, ProviderInfo } from '../types.ts'
import type { LlmQuotesApi } from './index.ts'
import { NS } from './locales.ts'
import { convertCurrency, formatContext, formatPrice, chooseComparePrice, isDiscountedPrice, priceTierLabel, priceUnitPriority } from './format.ts'
import { compareFields } from './compareFields.tsx'
import { loadCompareSelection, saveCompareSelection } from './compareStorage.ts'
import { useWatchlist, watchlistKey } from './useWatchlist.ts'
import { StarIcon } from './StarIcon.tsx'
import css from './styles.module.css'

/** Maximum number of models that can be added to a comparison. */
export const COMPARE_MAX = 10

/** One rendered key/value row inside a details section. */
interface DetailField {
  readonly label: string
  readonly value: ReactNode
}

export interface ModelDetailModalProps {
  t: TranslateNS<typeof NS>
  model: ModelInfo
  onClose: () => void
  /** API for watchlist sync + compare provider/model/FX loading. */
  api?: LlmQuotesApi
}

/** Format an ISO date as `YYYY-MM-DD`. */
function dateText(value: string): string {
  return value.slice(0, 10)
}

/** Format a token count for display (context/max output/tier bounds). */
function tokens(value: number): string {
  return formatContext(value)
}

/** Format a price of this row's own currency (symbol follows priceUnit). */
function money(value: number, price: PriceInfo): string {
  return formatPrice(value, price.priceUnit)
}

/** True when a price row carries at least one valued field. */
function hasValuedFields(price: PriceInfo): boolean {
  return Object.values(price).some((value) =>
    (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length > 0),
  )
}

/** Collect the valued fields of one price row into label/value pairs. */
export function priceFields(price: PriceInfo, t: TranslateNS<typeof NS>): DetailField[] {
  const out: DetailField[] = []
  const pushNumber = (label: string, value: number | null | undefined): void => {
    if (typeof value === 'number' && Number.isFinite(value)) out.push({ label, value: money(value, price) })
  }
  const pushText = (label: string, value: string | null | undefined): void => {
    if (typeof value === 'string' && value.length > 0) out.push({ label, value })
  }

  pushNumber(t('detail.input'), price.inputPricePerMillion)
  pushNumber(t('detail.output'), price.outputPricePerMillion)
  pushNumber(t('detail.thinkingOutput'), price.thinkingOutputPricePerMillion)
  pushNumber(t('detail.cachedInput'), price.cachedInputPricePerMillion)
  pushNumber(t('detail.cachedWrite'), price.cachedWritePricePerMillion)
  pushNumber(t('detail.imagePrice'), price.imagePrice)
  pushNumber(t('detail.imagePricePerMillion'), price.imagePricePerMillion)
  pushNumber(t('detail.audioPricePerHour'), price.audioPricePerHour)
  pushNumber(t('detail.audioPricePerMillion'), price.audioPricePerMillion)
  pushNumber(t('detail.videoPrice'), price.videoPrice)
  pushNumber(t('detail.videoPricePerSecond'), price.videoPricePerSecond)
  pushNumber(t('detail.videoPricePerMillion'), price.videoPricePerMillion)
  pushNumber(t('detail.characterPricePerMillion'), price.characterPricePerMillion)
  pushNumber(t('detail.pagePrice'), price.pagePrice)
  pushNumber(t('detail.searchPricePerThousand'), price.searchPricePerThousand)
  pushNumber(t('detail.trackPrice'), price.trackPrice)
  pushText(t('detail.processingTier'), price.processingTier)
  if (typeof price.tokenTierMin === 'number' && Number.isFinite(price.tokenTierMin)
    || typeof price.tokenTierMax === 'number' && Number.isFinite(price.tokenTierMax)) {
    const bounds: string[] = []
    if (typeof price.tokenTierMin === 'number' && Number.isFinite(price.tokenTierMin)) {
      bounds.push(`≥${tokens(price.tokenTierMin)}`)
    }
    if (typeof price.tokenTierMax === 'number' && Number.isFinite(price.tokenTierMax)) {
      bounds.push(`≤${tokens(price.tokenTierMax)}`)
    }
    out.push({ label: t('detail.tokenTier'), value: bounds.join(' ') })
  }
  pushText(t('detail.tierLabel'), price.tierLabel)
  pushText(t('detail.priceUnit'), price.priceUnit)
  pushText(t('detail.freeTier'), price.freeTier)
  pushText(t('detail.region'), price.region)
  if (typeof price.effectiveDate === 'string' && price.effectiveDate.length > 0) {
    out.push({ label: t('detail.effectiveDate'), value: dateText(price.effectiveDate) })
  }
  if (typeof price.sourceUrl === 'string' && price.sourceUrl.length > 0) {
    out.push({
      label: t('detail.sourceUrl'),
      value: (
        <a className={css.detailValueLink} href={price.sourceUrl} target="_blank" rel="noreferrer">
          {price.sourceUrl}
        </a>
      ),
    })
  }
  return out
}

/** Collect the valued model-level fields into label/value pairs. */
export function modelFields(model: ModelInfo, t: TranslateNS<typeof NS>): DetailField[] {
  const out: DetailField[] = []
  const pushText = (label: string, value: string | null | undefined): void => {
    if (typeof value === 'string' && value.length > 0) out.push({ label, value })
  }
  const pushTokens = (label: string, value: number | null | undefined): void => {
    if (typeof value === 'number' && Number.isFinite(value)) out.push({ label, value: tokens(value) })
  }
  const pushBool = (label: string, value: boolean | undefined): void => {
    out.push({
      label,
      value: (
        <span className={value ? css.detailValueYes : css.detailValueNo}>
          {value ? '✓' : '✗'}
        </span>
      ),
    })
  }

  pushText(t('detail.slug'), model.slug)
  pushText(t('detail.family'), model.family)
  pushText(t('detail.modelType'), model.modelType)
  pushTokens(t('detail.contextWindow'), model.contextWindow)
  pushTokens(t('detail.maxOutput'), model.maxOutput)
  if (model.modalities.length > 0) out.push({ label: t('detail.modalities'), value: model.modalities.join(', ') })
  pushBool(t('detail.supportsTools'), model.supportsTools)
  pushBool(t('detail.supportsBatch'), model.supportsBatch)
  pushBool(t('detail.supportsCaching'), model.supportsCaching)
  pushBool(t('detail.supportsStreaming'), model.supportsStreaming)
  if (typeof model.releaseDate === 'string' && model.releaseDate.length > 0) {
    out.push({ label: t('detail.releaseDate'), value: dateText(model.releaseDate) })
  }
  if (typeof model.knowledgeCutoff === 'string' && model.knowledgeCutoff.length > 0) {
    out.push({ label: t('detail.knowledgeCutoff'), value: dateText(model.knowledgeCutoff) })
  }
  if (typeof model.deprecatedAt === 'string' && model.deprecatedAt.length > 0) {
    out.push({ label: t('detail.deprecatedAt'), value: dateText(model.deprecatedAt) })
  }
  pushText(t('detail.providerName'), model.provider.name)
  pushText(t('detail.providerSlug'), model.provider.slug)
  return out
}

/** Section title for price rows; extra rows get an ordinal + tier label. */
function priceSectionTitle(t: TranslateNS<typeof NS>, price: PriceInfo, index: number): string {
  if (index === 0) return t('sq.detailPrice')
  const label = price.tierLabel ?? ''
  return label.length > 0 ? `${t('sq.detailPrice')} #${index + 1} · ${label}` : `${t('sq.detailPrice')} #${index + 1}`
}

/** One labelled section of the modal. */
export function DetailSection({ title, fields }: { title: string; fields: readonly DetailField[] }) {
  if (fields.length === 0) return null
  return (
    <section className={css.detailSection}>
      <h4 className={css.detailSectionTitle}>{title}</h4>
      <dl className={css.detailGrid}>
        {fields.map((field) => (
          <div className={css.detailField} key={field.label}>
            <dt className={css.detailKey}>{field.label}</dt>
            <dd className={css.detailValue}>{field.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * The modal popup. Portaled to `document.body` so the settings dialog
 * cannot clip or overlay it. Clicking the backdrop or pressing Escape closes.
 */
export function ModelDetailModal({ t, model, onClose, api }: ModelDetailModalProps) {
  const watchlist = useWatchlist(api)
  const isWatched = watchlist.isWatched(watchlistKey(model.provider.slug, model.slug))

  // Compare state: the provider tree lazily loads per provider on expand.
  const [compareOpen, setCompareOpen] = useState(false)
  const [providers, setProviders] = useState<readonly ProviderInfo[] | null>(null)
  const [providerModels, setProviderModels] = useState<Record<string, readonly ModelInfo[]>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [loadingProvs, setLoadingProvs] = useState<ReadonlySet<string>>(new Set())
  const [loadedProvs, setLoadedProvs] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<ReadonlyMap<string, ModelInfo>>(new Map())
  const [compareError, setCompareError] = useState<string | null>(null)
  const [rates, setRates] = useState<FxResponse | null>(null)
  const compareRef = useRef<HTMLDivElement>(null)
  const ratesTriedRef = useRef(false)

  const targetKey = watchlistKey(model.provider.slug, model.sid)
  // The price row the compare standardizes on: the standard (non-discounted)
  // tier when available, so DeepSeek-style off-peak rows compare to the peak
  // price. Its currency is the base the table normalizes to.
  const targetComparePrice = chooseComparePrice(model)
  const targetPriceUnit = targetComparePrice.priceUnit ?? null
  const targetDiscounted = isDiscountedPrice(targetComparePrice)
  const targetTierLabel = priceTierLabel(targetComparePrice)
  // The base the table normalizes to: the target's currency, or the FX base
  // when the target carries no currency. Null when rates are unavailable.
  const effectiveBaseUnit = targetPriceUnit ?? rates?.base ?? null

  // Reset per-target compare state and restore any persisted selection.
  useEffect(() => {
    setCompareOpen(false)
    setExpanded(new Set())
    setLoadingProvs(new Set())
    setLoadedProvs(new Set())
    setProviderModels({})
    setRates(null)
    ratesTriedRef.current = false
    setCompareError(null)
    setSelected(new Map(loadCompareSelection(targetKey).map((m) => [m.sid, m])))
  }, [targetKey])

  // Load the provider list once when the compare dropdown first opens.
  useEffect(() => {
    if (!compareOpen || api === undefined || providers !== null) return
    void api.providers().then((list) => {
      setProviders(list)
    }, (error) => {
      setCompareError(error instanceof Error ? error.message : String(error))
    })
  }, [compareOpen, api, providers])

  // Fetch FX rates (once) when at least one model is selected, so mixed
  // currencies can be normalized; a failure just leaves rates null (native).
  useEffect(() => {
    if (api === undefined || selected.size === 0 || rates !== null || ratesTriedRef.current) return
    ratesTriedRef.current = true
    void api.rates().then((fx) => {
      setRates(fx)
    }, () => {
      // Rates unavailable — the table stays native (compareNoFx note shows).
    })
  }, [api, selected.size, rates])

  // Close the compare dropdown on outside click.
  useEffect(() => {
    if (!compareOpen) return
    const onDown = (event: MouseEvent): void => {
      if (compareRef.current !== null && !compareRef.current.contains(event.target as Node)) {
        setCompareOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [compareOpen])

  // Escape closes the compare dropdown first, then the modal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (compareOpen) setCompareOpen(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, compareOpen])

  // Expand/collapse one provider node, lazily loading its models once.
  const toggleProvider = useCallback((slug: string): void => {
    if (api === undefined) return
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
    // Ignore a repeated click while loading or after a settled load.
    if (loadingProvs.has(slug) || loadedProvs.has(slug)) return
    setLoadingProvs((prev) => new Set(prev).add(slug))
    api.providerModels([slug]).then((byProvider) => {
      setProviderModels((prev) => ({ ...prev, ...byProvider }))
    }, (error) => {
      setCompareError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      setLoadingProvs((prev) => {
        const next = new Set(prev)
        next.delete(slug)
        return next
      })
      setLoadedProvs((prev) => new Set(prev).add(slug))
    })
  }, [api, loadingProvs, loadedProvs])

  // Toggle one comparison model in/out of the selected set (keyed by sid).
  const toggleModel = useCallback((cmpModel: ModelInfo): void => {
    // The target model itself is the reference column; comparing it to itself
    // would only add a duplicate, so it cannot be selected.
    if (cmpModel.provider.slug === model.provider.slug && cmpModel.sid === model.sid) return
    const has = selected.has(cmpModel.sid)
    if (!has && selected.size >= COMPARE_MAX) {
      // At the cap — the checkbox is disabled anyway; this guard is a backstop.
      return
    }
    const next = new Map(selected)
    if (has) next.delete(cmpModel.sid)
    else next.set(cmpModel.sid, cmpModel)
    setSelected(next)
    saveCompareSelection(targetKey, [...next.values()])
  }, [selected, model.provider.slug, model.sid, targetKey])

  // Remove one comparison model from the selected set.
  const removeModel = useCallback((sid: string): void => {
    const next = new Map(selected)
    if (next.delete(sid)) {
      setSelected(next)
      saveCompareSelection(targetKey, [...next.values()])
    }
  }, [selected, targetKey])

  const convert = useCallback((value: number, fromUnit: string | null | undefined): number | null => {
    if (rates === null) return null
    return convertCurrency(value, fromUnit, effectiveBaseUnit, rates.rates)
  }, [rates, effectiveBaseUnit])

  const selectedList = useMemo(() => [...selected.values()], [selected])
  const compareRows = useMemo(() => compareFields(model, t, { baseUnit: effectiveBaseUnit, convert }), [model, t, effectiveBaseUnit, convert])

  // Whether the table needs/to handle currency normalization.
  const selectedUnits = useMemo(
    () => selectedList.map((m) => chooseComparePrice(m).priceUnit),
    [selectedList],
  )
  const distinctUnits = useMemo(() => {
    const set = new Set<string>()
    for (const unit of [effectiveBaseUnit, ...selectedUnits]) {
      if (typeof unit === 'string' && unit.length > 0) set.add(unit)
    }
    return set
  }, [effectiveBaseUnit, selectedUnits])
  const mixedUnits = distinctUnits.size > 1
  const highlightOk = !mixedUnits || rates !== null
  const atCap = selected.size >= COMPARE_MAX

  // Best-value highlight per row: min for price fields, max for capacity.
  const bestMap = useMemo(() => {
    const map = new Map<string, number>()
    if (!highlightOk) return map
    for (const field of compareRows) {
      if (field.direction === undefined || field.numeric === undefined) continue
      let bestIndex = -1
      let bestValue = 0
      ;[model, ...selectedList].forEach((m, idx) => {
        const value = field.numeric!(m)
        if (value === null) return
        if (bestIndex === -1 || (field.direction === 'max' ? value > bestValue : value < bestValue)) {
          bestIndex = idx
          bestValue = value
        }
      })
      if (bestIndex !== -1) map.set(field.key, bestIndex)
    }
    return map
  }, [compareRows, selectedList, model, highlightOk])

  // Pricing sections ordered by currency: CNY first, then USD, then any
  // other currency (stable — ties keep dataset order).
  const priceRows = (model.prices.length > 0 ? model.prices : [model.price])
    .filter(hasValuedFields)
    .sort((a, b) => priceUnitPriority(a.priceUnit) - priceUnitPriority(b.priceUnit))

  return createPortal(
    <div className={css.modalOverlay} onClick={onClose}>
      <div
        className={`${css.modalCard}${selectedList.length > 0 ? ` ${css.modalCardWide}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={model.name}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={css.modalHeader}>
          <div className={css.modalTitle}>
            <button
              type="button"
              className={`${css.watchStar} ${css.watchStarLarge}${isWatched ? ` ${css.watchStarActive}` : ''}`}
              title={isWatched ? t('sq.unwatchlist') : t('sq.watchlist')}
              onClick={() => watchlist.toggle(watchlistKey(model.provider.slug, model.slug), model, model.provider.slug)}
            >
              <StarIcon size={18} filled={isWatched} />
            </button>
            <span>{model.name}</span>
            <span className={css.detailProviderTag}>{model.provider.name}</span>
          </div>
          <div className={css.modalHeaderActions}>
            {api !== undefined && (
              <div className={css.compareWrap} ref={compareRef}>
                <button
                  type="button"
                  className={`${css.primaryButton} ${css.compareButton}`}
                  aria-expanded={compareOpen}
                  onClick={() => setCompareOpen((open) => !open)}
                >
                  {t('sq.compare')} ▾
                </button>
                {compareOpen && (
                  <div className={css.compareMenu} data-testid="llm-quotes-compare">
                    {providers === null ? (
                      compareError !== null ? (
                        <div className={css.sqError}>{compareError}</div>
                      ) : (
                        <div className={css.compareLoading}>
                          <span className={css.spinner} aria-hidden="true" />
                          {t('sq.compareLoading')}
                        </div>
                      )
                    ) : providers.length === 0 ? (
                      <div className={css.compareEmpty}>{t('sq.compareEmpty')}</div>
                    ) : (
                      <div className={css.compareTree}>
                        {providers.map((provider) => {
                          const isExpanded = expanded.has(provider.slug)
                          const isLoading = loadingProvs.has(provider.slug)
                          const models = providerModels[provider.slug]
                          const hasModels = provider.modelCount > 0
                          const disabled = isLoading || !hasModels
                          return (
                            <div key={provider.slug} className={css.compareGroup}>
                              <button
                                type="button"
                                className={`${css.compareProvider}${isExpanded ? ` ${css.compareProviderOpen}` : ''}`}
                                disabled={disabled}
                                aria-expanded={isExpanded}
                                title={!hasModels ? t('sq.compareEmpty') : undefined}
                                onClick={() => toggleProvider(provider.slug)}
                              >
                                <span className={css.compareChevron}>{isExpanded ? '▾' : '▸'}</span>
                                <span className={css.compareProviderName}>{provider.name}</span>
                                <span className={css.compareProviderCount}>
                                  {hasModels ? provider.modelCount : t('sq.compareNoModels')}
                                </span>
                                {isLoading && (
                                  <span className={css.compareLoadingInline}>{t('sq.compareLoading')}</span>
                                )}
                              </button>
                              {isExpanded && isLoading && (
                                <div className={css.compareLoading} data-testid={`llm-quotes-compare-loading-${provider.slug}`}>
                                  <span className={css.spinner} aria-hidden="true" />
                                </div>
                              )}
                              {isExpanded && !isLoading && hasModels && (
                                models === undefined ? (
                                  <div className={css.compareEmpty} data-testid={`llm-quotes-compare-empty-${provider.slug}`}>
                                    {t('sq.compareEmpty')}
                                  </div>
                                ) : (
                                  <div className={css.compareChildren}>
                                    {models.map((cmpModel) => {
                                      const checked = selected.has(cmpModel.sid)
                                      const isTargetModel =
                                        cmpModel.provider.slug === model.provider.slug && cmpModel.sid === model.sid
                                      const disabled = isTargetModel || (!checked && atCap)
                                      return (
                                        <label
                                          key={cmpModel.sid}
                                          className={`${css.compareModelRow}${disabled ? ` ${css.compareModelRowDisabled}` : ''}`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={disabled}
                                            onChange={() => toggleModel(cmpModel)}
                                          />
                                          <span className={css.modelName}>{cmpModel.name}</span>
                                        </label>
                                      )
                                    })}
                                  </div>
                                )
                              )}
                            </div>
                          )
                        })}
                        <div className={css.compareFooter}>
                          <span>{t('sq.compareLimit', { max: COMPARE_MAX })}</span>
                          <span className={`${css.compareCount}${atCap ? ` ${css.compareCountFull}` : ''}`}>
                            {t('sq.compareSelected', { count: selected.size, max: COMPARE_MAX })}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <button type="button" className={css.modalClose} onClick={onClose} aria-label={t('sq.close')}>
              ×
            </button>
          </div>
        </div>
        <div className={css.modalBody}>
          {selectedList.length > 0 && (
            <section className={css.detailSection}>
              <div className={css.compareHeader}>
                <h4 className={css.compareHeaderTitle}>{t('sq.compare')}</h4>
                <div className={css.compareHeaderInfo}>
                  <span className={`${css.compareLimitText}${atCap ? ` ${css.compareLimitFull}` : ''}`}>
                    {t('sq.compareLimit', { max: COMPARE_MAX })}
                  </span>
                  <span className={`${css.compareCount}${atCap ? ` ${css.compareCountFull}` : ''}`}>
                    {t('sq.compareSelected', { count: selected.size, max: COMPARE_MAX })}
                  </span>
                  {mixedUnits && (
                    <span className={css.compareFxNote}>
                      {rates !== null
                        ? t('sq.compareUnified', { unit: effectiveBaseUnit ?? rates.base })
                        : t('sq.compareNoFx')}
                    </span>
                  )}
                </div>
              </div>
              <div className={css.compareTableWrap}>
                <table className={css.compareTable}>
                  <thead>
                    <tr>
                      <th className={css.compareFieldTh}>{t('sq.compareField')}</th>
                      <th>
                        <span className={css.modelName}>{model.name}</span>
                        <span className={css.compareColProvider}>{model.provider.name}</span>
                        {targetDiscounted && targetTierLabel !== null && (
                          <span className={css.compareTierTag}>{targetTierLabel}</span>
                        )}
                      </th>
                      {selectedList.map((cmpModel) => {
                        const cmpPrice = chooseComparePrice(cmpModel)
                        const discounted = isDiscountedPrice(cmpPrice)
                        const tierLabel = discounted ? priceTierLabel(cmpPrice) : null
                        return (
                          <th key={cmpModel.sid}>
                            <span className={css.compareColHeader}>
                              <span className={css.modelName}>{cmpModel.name}</span>
                              <button
                                type="button"
                                className={css.compareRemove}
                                title={t('sq.compareRemove')}
                                aria-label={t('sq.compareRemove')}
                                onClick={() => removeModel(cmpModel.sid)}
                              >
                                ×
                              </button>
                            </span>
                            <span className={css.compareColProvider}>{cmpModel.provider.name}</span>
                            {tierLabel !== null && <span className={css.compareTierTag}>{tierLabel}</span>}
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {compareRows.map((field) => {
                      const best = bestMap.get(field.key)
                      return (
                        <tr key={field.key}>
                          <td className={css.compareFieldTd}>{field.label}</td>
                          <td className={best === 0 ? css.compareBest : undefined}>{field.render(model)}</td>
                          {selectedList.map((cmpModel, idx) => (
                            <td key={cmpModel.sid} className={best === idx + 1 ? css.compareBest : undefined}>
                              {field.render(cmpModel)}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <DetailSection title={t('sq.detailModel')} fields={modelFields(model, t)} />
          {priceRows.map((price, index) => (
            <DetailSection
              key={index}
              title={priceSectionTitle(t, price, index)}
              fields={priceFields(price, t)}
            />
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}

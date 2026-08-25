/**
 * LLM Quotes panel: search/filter, price table with a Details popup, compare,
 * and local settings. The former Watch toggles and price alerts are gone —
 * configured models are implicitly watched; the Details popup shows every
 * valued model-level field.
 * @module dsh-llm-quotes/client/LlmQuotesPanel
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AppSettings,
  ModelInfo,
  ProviderInfo,
} from '../types.ts'
import type { LlmQuotesApi } from './index.ts'
import { NS } from './locales.ts'
import { currencySymbol, formatPrice, formatTime, pickDisplayPrice } from './format.ts'
import { ModelDetailModal } from './ModelDetailModal.tsx'
import css from './styles.module.css'

export interface LlmQuotesPanelProps {
  t: TranslateNS<typeof NS>
  api: LlmQuotesApi
  wide?: boolean
}

const PAGE_SIZE = 50

/** The panel body (intended to be wrapped by the entry's Modal). */
export function LlmQuotesPanel({ t, api }: LlmQuotesPanelProps) {
  const [models, setModels] = useState<readonly ModelInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const providerBySlug = useMemo(() => new Map(providers.map((p) => [p.slug, p])), [providers])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [stale, setStale] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [provider, setProvider] = useState('')
  const [modality, setModality] = useState('')
  const [modalities, setModalities] = useState<string[]>([])

  const [settings, setSettings] = useState<AppSettings>({ refreshMinutes: 1440, compareLimit: 5 })

  const [selected, setSelected] = useState<ModelInfo[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [compareDraft, setCompareDraft] = useState('5')
  const [savedFlash, setSavedFlash] = useState(false)
  const [detailModel, setDetailModel] = useState<ModelInfo | null>(null)

  const firstRender = useRef(true)

  const loadModels = useCallback(async (pageNum: number): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.models({
        q: q || undefined,
        provider: provider || undefined,
        modality: modality || undefined,
        page: pageNum,
        pageSize: PAGE_SIZE,
      })
      setModels(response.models)
      setTotal(response.total)
      setPage(response.page)
      setTotalPages(response.totalPages)
      setFetchedAt(response.fetchedAt)
      setStale(response.stale === true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [api, q, provider, modality])

  const loadMeta = useCallback(async (): Promise<void> => {
    try {
      const [providerList, modalityList, settingsResponse] = await Promise.all([
        api.providers(),
        api.modalities(),
        api.getSettings(),
      ])
      setProviders(providerList)
      setModalities(modalityList)
      setSettings(settingsResponse.settings)
    } catch {
      // Non-fatal; panel still shows the table once models load.
    }
  }, [api])

  useEffect(() => {
    void loadMeta()
    void loadModels(1)
    // Intentionally run once on mount; filter changes are handled by the
    // debounced effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced filter reload.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const timer = window.setTimeout(() => { void loadModels(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [q, provider, modality, loadModels])

  const refresh = useCallback((): void => {
    api.refresh().then((overview) => {
      setModels(overview.models)
      setTotal(overview.total)
      setPage(overview.page)
      setTotalPages(overview.totalPages)
      setFetchedAt(overview.fetchedAt)
      setStale(overview.stale === true)
    }, () => {
      // Keep existing rows on refresh failure.
    })
  }, [api])

  const toggleCompare = useCallback((model: ModelInfo): void => {
    setSelected((current) => {
      const exists = current.some((item) => item.sid === model.sid)
      if (exists) return current.filter((item) => item.sid !== model.sid)
      if (current.length >= settings.compareLimit) return current
      return [...current, model]
    })
  }, [settings.compareLimit])

  const clearCompare = useCallback((): void => {
    setSelected([])
    setCompareOpen(false)
  }, [])

  const openSettings = useCallback((): void => {
    setCompareDraft(String(settings.compareLimit))
    setSettingsOpen(true)
  }, [settings])

  const saveSettings = useCallback((): void => {
    const compareLimit = Number(compareDraft)
    api.updateSettings({
      compareLimit: Number.isFinite(compareLimit) ? compareLimit : undefined,
    }).then((state) => {
      setSettings(state.settings)
      setSettingsOpen(false)
      setSavedFlash(true)
      window.setTimeout(() => setSavedFlash(false), 1500)
    }, () => {
      // Ignore.
    })
  }, [api, compareDraft])

  const pageNumbers = useMemo(() => {
    const pages: number[] = []
    const start = Math.max(1, page - 2)
    const end = Math.min(totalPages, start + 4)
    for (let i = start; i <= end; i++) pages.push(i)
    return pages
  }, [page, totalPages])

  const specialPrice = (model: ModelInfo): string | null => {
    const p = model.price
    const sym = currencySymbol(p.priceUnit)
    if (p.imagePrice !== null && p.imagePrice !== undefined) return `${t('panel.specialPrice')}: ${sym}${p.imagePrice}/img`
    if (p.videoPricePerSecond !== null && p.videoPricePerSecond !== undefined) return `${t('panel.specialPrice')}: ${sym}${p.videoPricePerSecond}/s`
    if (p.audioPricePerHour !== null && p.audioPricePerHour !== undefined) return `${t('panel.specialPrice')}: ${sym}${p.audioPricePerHour}/h`
    return null
  }

  const pricingLink = (model: ModelInfo): string => {
    return providerBySlug.get(model.provider.slug)?.pricingUrl ?? ''
  }

  if (compareOpen && selected.length > 0) {
    return (
      <div className={css.panel}>
        <div className={css.panelBody} data-testid="llm-quotes-compare">
          <div className={css.toolbar}>
            <button type="button" className={css.linkButton} onClick={() => setCompareOpen(false)}>
              ← {t('panel.compareBack')}
            </button>
            <span className={css.toolbarTitle}>{t('panel.compareView')}</span>
            <button type="button" className={css.linkButton} onClick={clearCompare}>{t('panel.compareClear')}</button>
          </div>
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr>
                  <th>{t('panel.model')}</th>
                  <th>{t('panel.provider')}</th>
                  <th>{t('panel.input')}</th>
                  <th>{t('panel.output')}</th>
                  <th>{t('panel.link')}</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((model) => {
                  const displayPrice = pickDisplayPrice(model.prices) ?? model.price
                  return (
                    <tr key={model.sid}>
                      <td><span className={css.modelName}>{model.name}</span></td>
                      <td>{model.provider.name}</td>
                      <td>{formatPrice(displayPrice.inputPricePerMillion, displayPrice.priceUnit)}</td>
                      <td>{formatPrice(displayPrice.outputPricePerMillion, displayPrice.priceUnit)}</td>
                      <td>{pricingLink(model).length > 0
                        ? <a href={pricingLink(model)} target="_blank" rel="noreferrer">{t('panel.link')}</a>
                        : t('panel.na')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={css.panel}>
      <div className={css.panelBody}>
        <div className={css.toolbar}>
          <input
            className={css.search}
            type="search"
            placeholder={t('panel.searchPlaceholder')}
            value={q}
            onChange={(e) => { setQ(e.target.value) }}
          />
          <select className={css.select} value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">{t('panel.providerAll')}</option>
            {providers.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
          <select className={css.select} value={modality} onChange={(e) => setModality(e.target.value)}>
            <option value="">{t('panel.modalityAll')}</option>
            {modalities.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button type="button" className={css.button} onClick={refresh}>{t('panel.refresh')}</button>
          <button type="button" className={css.button} onClick={openSettings}>{t('panel.settings')}</button>
          {selected.length > 0 && (
            <button type="button" className={css.primaryButton} onClick={() => setCompareOpen(true)}>
              {t('panel.compare')} ({selected.length}/{settings.compareLimit})
            </button>
          )}
          {selected.length > 0 && (
            <button type="button" className={css.linkButton} onClick={clearCompare}>{t('panel.compareClear')}</button>
          )}
        </div>

        <div className={css.metaLine}>
          {fetchedAt !== null && (
            <span>{t('panel.updated', { time: formatTime(fetchedAt) })}{stale ? ` ${t('panel.stale')}` : ''}</span>
          )}
          {savedFlash && <span className={css.saved}>{t('panel.saved')}</span>}
        </div>

        {error !== null && <div className={css.error}>{t('panel.error', { message: error })}</div>}

        {loading && models.length === 0 ? (
          <div className={css.loadingState} role="status" data-testid="llm-quotes-loading">
            <span className={css.spinner} aria-hidden="true" />
            <span className={css.loadingTitle}>Loading LLM price data…</span>
            <span className={css.loadingHint}>
              The full dataset from llmrates.ai is being fetched. This can take a moment on first load.
            </span>
          </div>
        ) : (
          <div className={css.tableWrap}>
            <table className={css.table}>
              <thead>
                <tr>
                  <th className={css.colCheck} />
                  <th>{t('panel.model')}</th>
                  <th>{t('panel.provider')}</th>
                  <th>{t('panel.input')}</th>
                  <th>{t('panel.output')}</th>
                  <th>{t('sq.detail')}</th>
                  <th>{t('panel.link')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className={css.centerCell}>Loading…</td></tr>
                ) : models.length === 0 ? (
                  <tr><td colSpan={7} className={css.centerCell}>{t('panel.empty')}</td></tr>
                ) : models.map((model) => {
                  const special = specialPrice(model)
                  const checked = selected.some((item) => item.sid === model.sid)
                  const displayPrice = pickDisplayPrice(model.prices) ?? model.price
                  return (
                    <tr key={model.sid}>
                      <td className={css.colCheck}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && selected.length >= settings.compareLimit}
                          onChange={() => toggleCompare(model)}
                          aria-label={`${t('panel.compare')} ${model.name}`}
                        />
                      </td>
                      <td>
                        <span className={css.modelName}>{model.name}</span>
                        {special !== null && <span className={css.specialTag}>{special}</span>}
                      </td>
                      <td>{model.provider.name}</td>
                      <td>{formatPrice(displayPrice.inputPricePerMillion, displayPrice.priceUnit)}</td>
                      <td>{formatPrice(displayPrice.outputPricePerMillion, displayPrice.priceUnit)}</td>
                      <td>
                        <button
                          type="button"
                          className={css.detailButton}
                          onClick={() => setDetailModel(model)}
                        >
                          {t('sq.detail')}
                        </button>
                      </td>
                      <td>
                        {pricingLink(model).length > 0
                          ? <a href={pricingLink(model)} target="_blank" rel="noreferrer">{t('panel.link')}</a>
                          : t('panel.na')}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className={css.pagination}>
          <button type="button" className={css.button} disabled={page <= 1} onClick={() => { void loadModels(page - 1) }}>
            ‹
          </button>
          {pageNumbers.map((p) => (
            <button
              key={p}
              type="button"
              className={p === page ? `${css.button} ${css.activePage}` : css.button}
              onClick={() => { void loadModels(p) }}
            >
              {p}
            </button>
          ))}
          <button type="button" className={css.button} disabled={page >= totalPages} onClick={() => { void loadModels(page + 1) }}>
            ›
          </button>
          <span className={css.totalLabel}>{total}</span>
        </div>

        {settingsOpen && (
          <div className={css.settingsPanel} data-testid="llm-quotes-settings">
            <label className={css.field}>
              <span>{t('panel.settingsCompareLimit')}</span>
              <input
                type="number"
                min={2}
                max={10}
                value={compareDraft}
                onChange={(e) => setCompareDraft(e.target.value)}
              />
            </label>
            <button type="button" className={css.primaryButton} onClick={saveSettings}>{t('panel.save')}</button>
          </div>
        )}

        {detailModel !== null && (
          <ModelDetailModal t={t} model={detailModel} onClose={() => setDetailModel(null)} />
        )}
      </div>
    </div>
  )
}
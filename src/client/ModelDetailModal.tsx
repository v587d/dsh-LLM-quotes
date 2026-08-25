/**
 * Model detail popup: shows every model-level field of a quotes model that
 * has a value — model attributes plus all valued price-row fields — in a
 * clean sectioned modal. Shared by the Settings → Models quote blocks and
 * the prices panel.
 *
 * Boolean support flags are shown always (true/false), other fields only
 * when they carry a value, matching the "所有有值字段" requirement.
 * @module dsh-llm-quotes/client/ModelDetailModal
 */

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelInfo, PriceInfo } from '../types.ts'
import { NS } from './locales.ts'
import { formatContext, formatPrice, priceUnitPriority } from './format.ts'
import css from './styles.module.css'

/** One rendered key/value row inside a details section. */
interface DetailField {
  readonly label: string
  readonly value: ReactNode
}

export interface ModelDetailModalProps {
  t: TranslateNS<typeof NS>
  model: ModelInfo
  onClose: () => void
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
export function ModelDetailModal({ t, model, onClose }: ModelDetailModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Pricing sections ordered by currency: CNY first, then USD, then any
  // other currency (stable — ties keep dataset order).
  const priceRows = (model.prices.length > 0 ? model.prices : [model.price])
    .filter(hasValuedFields)
    .sort((a, b) => priceUnitPriority(a.priceUnit) - priceUnitPriority(b.priceUnit))

  return createPortal(
    <div className={css.modalOverlay} onClick={onClose}>
      <div
        className={css.modalCard}
        role="dialog"
        aria-modal="true"
        aria-label={model.name}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={css.modalHeader}>
          <div className={css.modalTitle}>
            <span>{model.name}</span>
            <span className={css.detailProviderTag}>{model.provider.name}</span>
          </div>
          <button type="button" className={css.modalClose} onClick={onClose} aria-label={t('sq.close')}>
            ×
          </button>
        </div>
        <div className={css.modalBody}>
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
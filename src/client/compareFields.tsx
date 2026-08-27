/**
 * Comparison table builder for the model detail popup.
 *
 * Frames the target model's valued fields as the rows of a comparison table:
 * the target model is the first data column and each selected comparison
 * model becomes a further column. Comparison models are aligned to the
 * target's field set — a field the target carries is always a row, and a
 * comparison model that lacks it shows the NA placeholder ("—") instead of
 * inventing a value. Fields the target does not carry are never added as
 * rows, so the table never grows beyond the target's shape.
 *
 * Prices are normalized to a common base currency when `options` supplies FX
 * conversion (see the modal), and each field carries a comparable `numeric`
 * value plus a `direction` so the UI can highlight the standout cell (max for
 * capacity fields, min for price fields).
 * @module dsh-llm-quotes/client/compareFields
 */

import { type ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelInfo, PriceInfo } from '../types.ts'
import { chooseComparePrice, formatContext, formatPrice } from './format.ts'
import { NS } from './locales.ts'
import css from './styles.module.css'

/** Placeholder shown when a comparison model lacks a target-valued field. */
export const NA = '—'

/** Render one comparison cell: the value for a given model, or NA. */
export type CompareFieldRender = (model: ModelInfo) => ReactNode

/** One row of the comparison table: a field of the target model. */
export interface CompareField {
  readonly key: string
  readonly label: string
  readonly render: CompareFieldRender
  /** Comparable numeric value for best-value highlighting, when numeric. */
  readonly numeric?: (model: ModelInfo) => number | null
  /** 'max' = higher is favored (capacity); 'min' = lower is favored (price). */
  readonly direction?: 'max' | 'min'
}

/** Conversion options for a mixed-currency comparison. */
export interface CompareOptions {
  /** Base currency every price is normalized to (the target's display unit). */
  readonly baseUnit?: string | null
  /** Convert a value from its own unit to the base unit; null when unavailable. */
  readonly convert?: (value: number, fromUnit: string | null | undefined) => number | null
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}

function hasNum(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * The price row a compare cell uses for a model: the standard (non-discounted)
 * tier when available, standardizing DeepSeek-style off-peak rows onto the
 * peak price so every column compares the same tier; falls back to the display
 * price when no standard row exists.
 */
function displayPriceOf(model: ModelInfo): PriceInfo {
  return chooseComparePrice(model)
}

function dateText(value: string): string {
  return value.slice(0, 10)
}

/** A boolean support flag rendered as a check/cross. */
function boolCell(value: boolean | undefined): ReactNode {
  return (
    <span className={value ? css.detailValueYes : css.detailValueNo}>
      {value ? '✓' : '✗'}
    </span>
  )
}

/**
 * Build the comparison rows for a target model. Only fields the target
 * carries are included; a comparison-model cell that lacks the field falls
 * back to NA. Prices are normalized to `options.baseUnit` when `options.convert`
 * resolves a rate.
 */
export function compareFields(target: ModelInfo, t: TranslateNS<typeof NS>, options: CompareOptions = {}): CompareField[] {
  const out: CompareField[] = []
  const targetPrice = displayPriceOf(target)
  const baseUnit = options.baseUnit ?? null
  const convert = options.convert

  // A text field: included when the target carries it; NA when absent.
  const text = (key: string, label: string, pick: (m: ModelInfo) => string | null | undefined): void => {
    if (!hasText(pick(target))) return
    out.push({
      key,
      label,
      render: (m) => {
        const value = pick(m)
        return hasText(value) ? value : NA
      },
    })
  }

  // A token-count field (formatted compactly); 'max' is favored.
  const tokens = (key: string, label: string, pick: (m: ModelInfo) => number | null | undefined): void => {
    if (!hasNum(pick(target))) return
    out.push({
      key,
      label,
      direction: 'max',
      numeric: (m) => {
        const value = pick(m)
        return hasNum(value) ? value : null
      },
      render: (m) => {
        const value = pick(m)
        return hasNum(value) ? formatContext(value) : NA
      },
    })
  }

  // A boolean support flag: always shown (they are always known).
  const bool = (key: string, label: string, pick: (m: ModelInfo) => boolean | undefined): void => {
    out.push({ key, label, render: (m) => boolCell(pick(m)) })
  }

  // A date field; included when the target has it.
  const date = (key: string, label: string, pick: (m: ModelInfo) => string | null | undefined): void => {
    if (!hasText(pick(target))) return
    out.push({
      key,
      label,
      render: (m) => {
        const value = pick(m)
        return hasText(value) ? dateText(value) : NA
      },
    })
  }

  // A price field taken from each model's own display price row. 'min' is
  // favored (cheapest) and the value is normalized to the base currency.
  const money = (key: string, label: string, pick: (p: PriceInfo) => number | null | undefined): void => {
    if (!hasNum(pick(targetPrice))) return
    const resolve = (m: ModelInfo): { value: number; unit: string | null | undefined } | null => {
      const price = displayPriceOf(m)
      const raw = pick(price)
      if (!hasNum(raw)) return null
      const converted = convert ? convert(raw, price.priceUnit) : null
      return { value: converted ?? raw, unit: converted !== null ? baseUnit : price.priceUnit }
    }
    out.push({
      key,
      label,
      direction: 'min',
      numeric: (m) => resolve(m)?.value ?? null,
      render: (m) => {
        const resolved = resolve(m)
        if (resolved === null) return NA
        return formatPrice(resolved.value, resolved.unit)
      },
    })
  }

  // A non-numeric price field (tier/unit/region) from each model's display row.
  const priceText = (key: string, label: string, pick: (p: PriceInfo) => string | null | undefined): void => {
    if (!hasText(pick(targetPrice))) return
    out.push({
      key,
      label,
      render: (m) => {
        const price = displayPriceOf(m)
        const value = pick(price)
        return hasText(value) ? value : NA
      },
    })
  }

  // --- Model-level fields (aligned to the target's valued set). ---
  text('slug', t('detail.slug'), (m) => m.slug)
  text('family', t('detail.family'), (m) => m.family)
  text('modelType', t('detail.modelType'), (m) => m.modelType)
  tokens('contextWindow', t('detail.contextWindow'), (m) => m.contextWindow)
  tokens('maxOutput', t('detail.maxOutput'), (m) => m.maxOutput)
  if (target.modalities.length > 0) {
    out.push({
      key: 'modalities',
      label: t('detail.modalities'),
      render: (m) => (m.modalities.length > 0 ? m.modalities.join(', ') : NA),
    })
  }
  bool('supportsTools', t('detail.supportsTools'), (m) => m.supportsTools)
  bool('supportsBatch', t('detail.supportsBatch'), (m) => m.supportsBatch)
  bool('supportsCaching', t('detail.supportsCaching'), (m) => m.supportsCaching)
  bool('supportsStreaming', t('detail.supportsStreaming'), (m) => m.supportsStreaming)
  date('releaseDate', t('detail.releaseDate'), (m) => m.releaseDate)
  date('knowledgeCutoff', t('detail.knowledgeCutoff'), (m) => m.knowledgeCutoff)
  date('deprecatedAt', t('detail.deprecatedAt'), (m) => m.deprecatedAt)

  // --- Price-level fields from the target's display price. ---
  money('input', t('detail.input'), (p) => p.inputPricePerMillion)
  money('output', t('detail.output'), (p) => p.outputPricePerMillion)
  money('thinkingOutput', t('detail.thinkingOutput'), (p) => p.thinkingOutputPricePerMillion)
  money('cachedInput', t('detail.cachedInput'), (p) => p.cachedInputPricePerMillion)
  money('cachedWrite', t('detail.cachedWrite'), (p) => p.cachedWritePricePerMillion)
  money('imagePrice', t('detail.imagePrice'), (p) => p.imagePrice)
  money('imagePricePerMillion', t('detail.imagePricePerMillion'), (p) => p.imagePricePerMillion)
  money('audioPricePerHour', t('detail.audioPricePerHour'), (p) => p.audioPricePerHour)
  money('audioPricePerMillion', t('detail.audioPricePerMillion'), (p) => p.audioPricePerMillion)
  money('videoPrice', t('detail.videoPrice'), (p) => p.videoPrice)
  money('videoPricePerSecond', t('detail.videoPricePerSecond'), (p) => p.videoPricePerSecond)
  money('videoPricePerMillion', t('detail.videoPricePerMillion'), (p) => p.videoPricePerMillion)
  money('characterPricePerMillion', t('detail.characterPricePerMillion'), (p) => p.characterPricePerMillion)
  money('pagePrice', t('detail.pagePrice'), (p) => p.pagePrice)
  money('searchPricePerThousand', t('detail.searchPricePerThousand'), (p) => p.searchPricePerThousand)
  money('trackPrice', t('detail.trackPrice'), (p) => p.trackPrice)
  priceText('processingTier', t('detail.processingTier'), (p) => p.processingTier)

  // Token tier: a bound expression (min/max) from the display price; the upper
  // bound drives the 'max is better' highlight.
  if (hasNum(targetPrice.tokenTierMin) || hasNum(targetPrice.tokenTierMax)) {
    out.push({
      key: 'tokenTier',
      label: t('detail.tokenTier'),
      direction: 'max',
      numeric: (m) => {
        const price = displayPriceOf(m)
        if (hasNum(price.tokenTierMax)) return price.tokenTierMax
        if (hasNum(price.tokenTierMin)) return price.tokenTierMin
        return null
      },
      render: (m) => {
        const price = displayPriceOf(m)
        const bounds: string[] = []
        if (hasNum(price.tokenTierMin)) bounds.push(`≥${formatContext(price.tokenTierMin)}`)
        if (hasNum(price.tokenTierMax)) bounds.push(`≤${formatContext(price.tokenTierMax)}`)
        return bounds.length > 0 ? bounds.join(' ') : NA
      },
    })
  }

  priceText('tierLabel', t('detail.tierLabel'), (p) => p.tierLabel)
  priceText('priceUnit', t('detail.priceUnit'), (p) => p.priceUnit)
  priceText('freeTier', t('detail.freeTier'), (p) => p.freeTier)
  priceText('region', t('detail.region'), (p) => p.region)

  if (hasText(targetPrice.effectiveDate)) {
    out.push({
      key: 'effectiveDate',
      label: t('detail.effectiveDate'),
      render: (m) => {
        const price = displayPriceOf(m)
        const value = price.effectiveDate
        return hasText(value) ? dateText(value) : NA
      },
    })
  }

  if (hasText(targetPrice.sourceUrl)) {
    out.push({
      key: 'sourceUrl',
      label: t('detail.sourceUrl'),
      render: (m) => {
        const price = displayPriceOf(m)
        const value = price.sourceUrl
        if (!hasText(value)) return NA
        return (
          <a className={css.detailValueLink} href={value} target="_blank" rel="noreferrer">
            {value}
          </a>
        )
      },
    })
  }

  return out
}

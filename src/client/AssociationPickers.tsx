/**
 * Association pickers for the Settings → Models quote blocks.
 *
 * Both pickers are modals (portaled to `document.body`) with a flat,
 * single-select list — deliberately no dropdowns:
 * - ProviderPickerModal lists every quotes-dataset provider; subscription
 *   token/coding-plan providers are shown disabled with a friendly note
 *   explaining they are out of scope.
 * - ModelPickerModal lists every model of an already-matched provider for
 *   the last-resort per-model association.
 * @module dsh-llm-quotes/client/AssociationPickers
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelInfo, ProviderInfo } from '../types.ts'
import { NS } from './locales.ts'
import { isExcludedPlanProvider } from './matching.ts'
import css from './styles.module.css'

/** Close on Escape if the modal is open. */
function useEscape(onClose: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

export interface ProviderPickerModalProps {
  t: TranslateNS<typeof NS>
  /** Every quotes-dataset provider. */
  providers: readonly ProviderInfo[]
  /** Slug preselected when it exists in the list (current association). */
  initial: string
  /** Harness provider this association is being made for (header label). */
  forProvider: string
  onSave: (quoteProvider: string) => void
  onCancel: () => void
}

/** Flat single-select modal: choose the quotes provider to associate. */
export function ProviderPickerModal({ t, providers, initial, forProvider, onSave, onCancel }: ProviderPickerModalProps) {
  const [selected, setSelected] = useState(() => {
    const found = providers.find((provider) => provider.slug === initial)
    return found !== undefined && !isExcludedPlanProvider(found) ? initial : ''
  })
  useEscape(onCancel)

  return createPortal(
    <div className={css.modalOverlay} onClick={onCancel}>
      <div
        className={css.modalCard}
        role="dialog"
        aria-modal="true"
        aria-label={`${t('sq.associate')} ${forProvider}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={css.modalHeader}>
          <div className={css.modalTitle}>
            <span>{t('sq.associate')}</span>
            <span className={css.pickerTargetTag}>{forProvider}</span>
          </div>
          <button type="button" className={css.modalClose} onClick={onCancel} aria-label={t('sq.close')}>
            ×
          </button>
        </div>
        <div className={css.modalBody}>
          <div className={css.pickerNote}>{t('sq.planExcluded')}</div>
          <div className={css.pickerList}>
            {providers.map((provider) => {
              const excluded = isExcludedPlanProvider(provider)
              const active = !excluded && selected === provider.slug
              return (
                <button
                  key={provider.slug}
                  type="button"
                  className={active ? `${css.pickerItem} ${css.pickerItemSelected}` : css.pickerItem}
                  disabled={excluded}
                  aria-pressed={active}
                  onClick={() => setSelected(provider.slug)}
                >
                  <span className={css.pickerItemName}>{provider.name}</span>
                  {provider.nameLocal !== undefined && provider.nameLocal !== null && provider.nameLocal !== provider.name && (
                    <span className={css.pickerItemLocal}>{provider.nameLocal}</span>
                  )}
                  {excluded && <span className={css.pickerTag}>{t('sq.planTag')}</span>}
                </button>
              )
            })}
          </div>
        </div>
        <div className={css.pickerFooter}>
          <button
            type="button"
            className={css.primaryButton}
            disabled={selected.length === 0}
            onClick={() => onSave(selected)}
          >
            {t('sq.save')}
          </button>
          <button type="button" className={css.button} onClick={onCancel}>
            {t('sq.cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export interface ModelPickerModalProps {
  t: TranslateNS<typeof NS>
  /** Every model of the already-matched provider. */
  models: readonly ModelInfo[]
  /** Model slug preselected when present (current association). */
  initial: string
  /** Harness model this association is being made for (header label). */
  forModel: string
  onSave: (quoteModelSlug: string) => void
  onCancel: () => void
}

/** Flat single-select modal: choose the quotes model for one harness model. */
export function ModelPickerModal({ t, models, initial, forModel, onSave, onCancel }: ModelPickerModalProps) {
  const [selected, setSelected] = useState(() => models.some((model) => model.slug === initial) ? initial : '')
  useEscape(onCancel)

  return createPortal(
    <div className={css.modalOverlay} onClick={onCancel}>
      <div
        className={css.modalCard}
        role="dialog"
        aria-modal="true"
        aria-label={`${t('sq.associateModel')} ${forModel}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={css.modalHeader}>
          <div className={css.modalTitle}>
            <span>{t('sq.associateModel')}</span>
            <span className={css.pickerTargetTag}>{forModel}</span>
          </div>
          <button type="button" className={css.modalClose} onClick={onCancel} aria-label={t('sq.close')}>
            ×
          </button>
        </div>
        <div className={css.modalBody}>
          <div className={css.pickerList}>
            {models.map((model) => {
              const active = selected === model.slug
              return (
                <button
                  key={model.slug}
                  type="button"
                  className={active ? `${css.pickerItem} ${css.pickerItemSelected}` : css.pickerItem}
                  aria-pressed={active}
                  onClick={() => setSelected(model.slug)}
                >
                  <span className={css.pickerItemName}>{model.name}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className={css.pickerFooter}>
          <button
            type="button"
            className={css.primaryButton}
            disabled={selected.length === 0}
            onClick={() => onSave(selected)}
          >
            {t('sq.save')}
          </button>
          <button type="button" className={css.button} onClick={onCancel}>
            {t('sq.cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
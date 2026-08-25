/**
 * DOM helpers locating the Settings → Models provider cards.
 *
 * The Models section (rendered by dsh-client-ui-settings-models) has no
 * per-provider slot, so the quotes block anchors itself to the shipped card
 * DOM. The selectors rely on stable structure, not hashed CSS classes:
 * - the settings panel is the nearest `[role="dialog"]` ancestor;
 * - the active settings section renders inside `[data-slot="settings.section"]`;
 * - the Models section is the one whose `h2` carries the section title;
 * - provider cards are the `li` items whose first child is the card head
 *   (`div > span > span`, the display-name row).
 * @module dsh-llm-quotes/client/modelsSectionDom
 */

/** One provider card in the Models section. */
export interface ProviderCardRef {
  /** The provider card list item. */
  readonly li: HTMLLIElement
  /** Display name shown in the card header (rowName text). */
  readonly displayName: string
}

/**
 * Locate the Models section inside the settings panel that owns `root`.
 * Returns null when the panel is absent or another section is active.
 */
export function findModelsSection(root: Element, modelsTitle: string): HTMLElement | null {
  const dialog = root.closest('[role="dialog"]')
  if (dialog === null) return null
  const outlet = dialog.querySelector('[data-slot="settings.section"]')
  const section = outlet?.firstElementChild
  if (!(section instanceof HTMLElement)) return null
  const heading = section.querySelector('h2')
  if (heading === null || (heading.textContent ?? '').trim() !== modelsTitle) return null
  return section
}

/** Collect the provider cards rendered inside the Models section. */
export function providerCardsOf(section: HTMLElement): ProviderCardRef[] {
  const cards: ProviderCardRef[] = []
  const ul = section.querySelector('ul')
  if (ul === null) return cards
  for (const child of ul.children) {
    if (!(child instanceof HTMLLIElement)) continue
    const displayName = cardDisplayName(child)
    if (displayName !== null) cards.push({ li: child, displayName })
  }
  return cards
}

/**
 * Read the provider display name from a card's head row
 * (`li > div.rowHead > span.rowIdentity > span.rowName`). Returns null for
 * cards without that structure (e.g. the first-run setup card).
 */
export function cardDisplayName(li: HTMLLIElement): string | null {
  const head = li.firstElementChild
  if (!(head instanceof HTMLElement) || head.tagName !== 'DIV') return null
  const identity = head.firstElementChild
  if (!(identity instanceof HTMLElement) || identity.tagName !== 'SPAN') return null
  const name = identity.firstElementChild
  if (!(name instanceof HTMLElement) || name.tagName !== 'SPAN') return null
  const text = name.textContent?.trim() ?? ''
  return text.length > 0 ? text : null
}

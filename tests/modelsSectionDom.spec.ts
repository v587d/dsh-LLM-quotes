// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cardDisplayName, findModelsSection, providerCardsOf } from '../src/client/modelsSectionDom.ts'

/** Build a settings dialog DOM with a Models section and provider cards.
 * `root` is the injector's own node, rendered inside the dialog's header
 * actions — exactly like the `settings.action` occupant in the real shell. */
function buildDialog(options: { title?: string; cards?: Array<{ name: string; setup?: boolean }> } = {}): {
  root: HTMLDivElement
  cards: HTMLLIElement[]
} {
  const dialog = document.createElement('div')
  dialog.setAttribute('role', 'dialog')

  // Header actions seat: the injector's root lives here.
  const root = document.createElement('div')
  root.setAttribute('data-slot', 'settings.action')
  dialog.appendChild(root)

  const outlet = document.createElement('div')
  outlet.setAttribute('data-slot', 'settings.section')
  dialog.appendChild(outlet)

  const section = document.createElement('section')
  outlet.appendChild(section)
  const heading = document.createElement('h2')
  heading.textContent = options.title ?? 'Models'
  section.appendChild(heading)

  const ul = document.createElement('ul')
  section.appendChild(ul)

  const cards: HTMLLIElement[] = []
  for (const card of options.cards ?? []) {
    const li = document.createElement('li')
    if (card.setup) {
      li.textContent = 'setup card without head'
    } else {
      const head = document.createElement('div')
      const identity = document.createElement('span')
      const name = document.createElement('span')
      name.textContent = card.name
      identity.appendChild(name)
      head.appendChild(identity)
      li.appendChild(head)
    }
    ul.appendChild(li)
    cards.push(li)
  }
  document.body.appendChild(dialog)
  return { root, cards }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('findModelsSection', () => {
  it('locates the Models section through the dialog + slot outlet', () => {
    const { root } = buildDialog({ cards: [{ name: 'xAI' }] })
    expect(findModelsSection(root, 'Models')).not.toBeNull()
  })

  it('returns null when the title does not match (another section is active)', () => {
    const { root } = buildDialog({ title: 'General', cards: [{ name: 'xAI' }] })
    expect(findModelsSection(root, 'Models')).toBeNull()
  })

  it('returns null outside a dialog', () => {
    const plain = document.createElement('div')
    expect(findModelsSection(plain, 'Models')).toBeNull()
  })
})

describe('providerCardsOf + cardDisplayName', () => {
  it('collects cards with a head row and skips setup cards', () => {
    const { root } = buildDialog({
      cards: [{ name: 'xAI' }, { name: 'DeepSeek' }, { name: 'zzz', setup: true }],
    })
    const section = findModelsSection(root, 'Models')!
    const cards = providerCardsOf(section)
    expect(cards.map((card) => card.displayName)).toEqual(['xAI', 'DeepSeek'])
  })

  it('returns an empty list for a section without a rows list', () => {
    const { root } = buildDialog({})
    const section = findModelsSection(root, 'Models')!
    expect(providerCardsOf(section)).toEqual([])
  })

  it('reads the display name from the card head', () => {
    const { root } = buildDialog({ cards: [{ name: 'xAI' }] })
    const section = findModelsSection(root, 'Models')!
    expect(cardDisplayName(providerCardsOf(section)[0]!.li)).toBe('xAI')
  })
})

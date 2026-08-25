# Plan

Status: **approved — implementation in progress**.

## Goals

- Show latest LLM provider API prices from LLMRates.ai.
- Put the prices inside **Settings → Models**: one quote block per configured provider, with input/output prices and a details popup (no official pricing links, no Watch step — configured models are implicitly watched).
- Support search/filter, compare, and links to official pricing pages (prices panel — later migration).
- Keep all user data local; no accounts.

## Approved Decisions

- **TypeScript + React** for the plugin core; Python only for optional helper scripts.
- **JSON persistence**:
  - `~/.dsh/llm-quotes.json` — user config: settings, model-level associations.
  - `~/.dsh/llm-quotes-data.json` — cached LLMRates dataset snapshot.
  - Browser `localStorage` (`llm-quotes.provider-associations`) — provider-level associations (the running dsh host cannot hot-load host-side changes, so this browser-owned preference needs no host route).
- **Entry point**: the sidebar footer entry was removed; the browser half now registers a `settings.action` occupant (`id: llm-quotes`) that injects quote blocks under each Models provider card via React portals (the shipped Models section has no per-provider slot).
- **LLMRates data freshness**:
  - Official site says the dataset is **updated daily**; endpoints are edge-cached and refreshed frequently.
  - Sync cadence: **at most once per calendar day**. The host checks shortly
    after startup and refetches when the saved snapshot was not fetched
    today (the first time dsh opens that day); a cheap hourly presence check
    only compares local timestamps, so a process running across midnight
    still picks up the new day without polling the network.
  - A snapshot fetched today counts as fresh (`sameLocalDay`), so the
    in-process cache and the "stale" badge follow the same daily rule. The
    legacy `refreshMinutes` setting is kept for storage/API compatibility
    but no longer drives the sync.
  - Fetch behavior: **only write the dataset JSON on a successful fetch**; on failure keep serving the last good local snapshot if present, otherwise surface an error.
- **No Watch / alerts (2026-08)**:
  - The Watch column and its host-side watch targets + price-change alerts were
    removed entirely: successfully configured models are implicitly watched, so
    an explicit toggle, watchlist, and alert ring added nothing.
- **Compare**: default limit **5 models**, configurable via settings (prices panel, later migration).

## Proposed Milestones

1. **Scaffold** — create dsh bundle package with client entry, register `sidebar.footer.action`.
2. **Minimal UI** — sidebar entry + modal that fetches and displays a simple price list.
3. **Core features** — search/filter, provider/model compare, official links.
4. **Persistence** — local JSON store for settings and associations.
5. **Details** — model detail popup with every valued model-level field.
6. **Polish** — i18n, empty/error states, theme consistency.

## Architecture

```text
dsh-LLM-quotes/
├── package.json              # dsh bundle metadata + client declaration
├── cordis.patch.yml          # insert host plugin row
├── tsconfig.json
├── tsconfig.prepare.json
├── tsdown.config.ts          # host ESM + browser closure-factory bundle
├── tsdown.shared.ts          # browser bundle helper (CSS modules inlined)
├── docs/PLAN.md
├── src/
│   ├── index.ts              # host half: register service + routes
│   ├── types.ts              # shared types
│   ├── config.ts             # local JSON paths + store/data load/save
│   ├── llmrates.ts           # LLMRates client, normalization, cache
│   ├── client/
│   │   ├── index.ts          # register settings.action (quote blocks)
│   │   ├── locales.ts        # en/zh
│   │   ├── SettingsModelsQuotes.tsx
│   │   ├── useQuotesData.ts
│   │   ├── ModelDetailModal.tsx # detail popup (all valued fields)
│   │   ├── matching.ts
│   │   ├── modelsSectionDom.ts
│   │   ├── providerAssociations.ts
│   │   ├── LlmQuotesPanel.tsx # prices panel (kept, unregistered)
│   │   └── styles.module.css
│   └── server/
│       ├── routes.ts         # same-origin JSON API
│       └── store.ts          # settings/associations local store
└── tests/                    # vitest unit tests
```

## Host API

Prefix `/api/llm-quotes`:

| Method | Path | Description |
|---|---|---|
| GET | `/overview` | Providers + first page models + fetchedAt |
| GET | `/models` | Filtered/paginated models (`q`, `provider`, `modality`, `page`, `pageSize`) |
| GET | `/providers` | Provider list |
| GET | `/modalities` | Distinct model modalities |
| POST | `/refresh` | Force refresh LLMRates data |
| GET | `/settings` | Read settings |
| POST | `/settings` | Update settings (`compareLimit` — `refreshMinutes` kept for compatibility) |
| GET | `/provider-models` | Full unpaginated model lists for provider slugs (`providers=a,b,c`) |
| GET | `/associations` | Manual associations (harness model → quotes model) |
| PUT | `/associations` | Upsert one association |
| DELETE | `/associations` | Remove one association |

## Settings → Models quote blocks (2026-08)

Every provider card gets a **Quotes** block below it, anchored by a
`settings.action` occupant that watches the settings dialog DOM (see
`src/client/modelsSectionDom.ts` for the stable selectors — no hashed CSS
classes) and portals one block per card.

Each block is a compact table of the provider's configured models with
**Input / Output** prices and a **Details** action; the popup
(`src/client/ModelDetailModal.tsx`) shows every valued model-level field —
attributes (context, max output, modalities, capabilities, dates) plus all
valued price-row fields (every priced modality, tiers, unit, region, source).

An **unmatched provider shows no model list** at all (nothing meaningful to
list); its only path is the provider-association modal. All manual
association goes through flat single-select **modal pickers**
(`src/client/AssociationPickers.tsx`), never dropdowns or inline rows: the
provider picker lists every dataset provider (token/coding-plan providers
are disabled with a friendly note — see `isExcludedPlanProvider` in
`src/client/matching.ts`), and the model picker lists the matched provider's
models for the last-resort per-model association. Unmatched model rows show
only `Not found` + the associate button.

Matching against the quotes dataset:

1. Provider route (Settings → Models slug) → quotes-provider slug: a stored
   **provider-level association** wins, then exact match, then the built-in
   alias map in `src/client/matching.ts` (e.g. `deepseek-official` →
   `deepseek`, `google-vertex` → `google-gemini`, `moonshotai` →
   `moonshot`).
2. Harness model id → quotes model: exact slug match, then case-insensitive
   display-name match — the model rows resolve by slug/name once the provider
   is associated; no per-model association is needed.
3. Provider-level associations persist in browser `localStorage`
   (`src/client/providerAssociations.ts`); a per-model manual association
   stays as the last resort and persists in `~/.dsh/llm-quotes.json`
   (`associations` array).

Note on slug ownership: the harness itself defines only the
`deepseek-official` route (its own adapter). Everything else shown in
Settings → Models comes from the pi-ai catalog (`@earendil-works/pi-ai`,
e.g. `xai`, `opencode-go`, `deepseek`) or is hand-declared by the user
(e.g. `zzz-gateway`) — the alias map is the bridge between those
vocabularies and the LLMRates slugs.

## Verification

- `pnpm install`
- `pnpm run typecheck`
- `pnpm run build`
- `pnpm test`
- Manual: add as local link to dsh web profile, refresh the page, open
  Settings → Models and verify per-provider quote blocks (Input/Output +
  Details popup) and provider-level association.

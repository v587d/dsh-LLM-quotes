# dsh-LLM-quotes

A DeepSeek Harness (dsh) web plugin that provides **the latest LLM provider API prices** inside the **Settings → Models** page: every configured provider card gets a quote block with per-model input/output prices and a details popup (every valued model-level field), with provider-level association and slug-based model matching (manual per-model association only as a last resort). Configured models are implicitly priced; an explicit **watchlist** (star toggles in the quote tables and the details popup) is persisted to `~/.dsh/llm-quotes-watchlist.jsonl` — follow upserts an `active` record, unfollow **pauses** it (status `paused`, history kept) so price trends stay computable, and the host snapshots active records after each dataset refresh. A standalone prices panel (search/compare) is kept for a later migration. Settings and associations (provider-level in localStorage, model-level in the host store) are persisted locally.

## Tech Stack

- **Core plugin: TypeScript + React** — this is the right fit because dsh web plugins are browser-side `window.__ModuleLoader__` modules rendered with React. The plugin must integrate with dsh slots and primitives.
- **Host side: TypeScript on dsh/Cordis** — the plugin runs inside the dsh process; host-side routes provide same-origin JSON APIs and local file persistence.
- **Python: optional auxiliary only** — may be used for offline scripts, data analysis, or future MCP tooling, but not for the dsh web UI plugin itself. If you want to help in Python, we can keep a `scripts/` area for that.

## Persistence

- Local-only files:
  - `~/.dsh/llm-quotes.json` — user config: settings, model-level associations (JSON chosen for zero-dependency parsing in TS; YAML can be considered later if a human-edited config becomes more important).
  - `~/.dsh/llm-quotes-data.json` — last successfully fetched LLMRates dataset snapshot; written only after a successful fetch.
  - `~/.dsh/llm-quotes-watchlist.jsonl` — watched models with price history (status lifecycle `active`/`paused`/`archived`; unfollow pauses, it never deletes the record).
- No accounts, no registration, no telemetry, no cloud storage.

## Project Layout

```text
dsh-LLM-quotes/
├── AGENTS.md
├── README.md               # root readme / quick overview
├── package.json            # dsh bundle metadata + client entry
├── cordis.patch.yml        # dsh plugin roster patch
├── tsconfig.json
├── tsconfig.prepare.json
├── tsdown.config.ts        # host + browser bundle build
├── tsdown.shared.ts        # browser bundle helper (CSS modules inlined)
├── docs/
│   ├── PLAN.md             # roadmap / decisions
│   └── GOTCHAS.md          # dsh/API pitfalls
├── src/
│   ├── index.ts            # host half: Cordis plugin, routes, persistence
│   ├── config.ts           # local config schema/load/save
│   ├── types.ts            # shared types
│   ├── llmrates.ts         # LLMRates.ai client (host or shared)
│   ├── client/
│   │   ├── index.ts            # browser half: apply/inject, slot registration
│   │   ├── locales.ts          # en/zh copy
│   │   ├── SettingsModelsQuotes.tsx  # per-provider quote blocks (portals)
│   │   ├── useQuotesData.ts   # shared quotes data hook
│   │   ├── ModelDetailModal.tsx  # model detail popup (all valued fields)
│   │   ├── useWatchlist.ts   # star/follow state (localStorage + host sync)
│   │   ├── StarIcon.tsx      # star icon for watchlist toggles
│   │   ├── matching.ts         # provider/model matching + associations
│   │   ├── modelsSectionDom.ts # Models-section DOM anchors (no hashed classes)
│   │   ├── providerAssociations.ts  # provider-level associations (localStorage)
│   │   ├── LlmQuotesPanel.tsx  # prices panel (kept for later migration)
│   │   └── styles.module.css
│   └── server/
│       ├── routes.ts       # same-origin JSON API (incl. watchlist endpoints)
│       ├── watchlist.ts    # watchlist JSONL persistence (status + price history)
│       └── store.ts        # local JSON store / settings / associations
├── tests/                  # vitest unit tests
└── scripts/                # optional Python helper scripts (not core)
```

Keep the structure minimal. Do not add abstraction layers until they earn their place.

## Key Constraints

- **Never modify `~/.dsh/` source or dependencies.** It is a read-only reference and the dsh harness is an important dependency.
- Use the dsh slot system. The quote blocks register as a **`settings.action`** occupant (`id: llm-quotes`) that renders nothing in the header and injects one block under every Settings → Models provider card via React portals; `sidebar.settings` stays owned by the settings shell. The DOM anchors live in `src/client/modelsSectionDom.ts` — keep them class-name-free.
- LLMRates.ai is free, read-only, no API key, CORS-enabled. Prefer direct API calls when possible; add host-side proxying only if needed for persistence, rate limiting, or hiding non-public data.
- All user data stays local. No auth, no accounts.
- **KISS.** If a feature starts to feel complex, stop and consult instead of forcing a bigger design.

## Docs

- [README.md](README.md) — quick overview
- [docs/PLAN.md](docs/PLAN.md) — roadmap and decisions
- [docs/GOTCHAS.md](docs/GOTCHAS.md) — dsh and LLMRates pitfalls

## Working Style

- English-first for docs and code comments to keep tokens low.
- Prefer simple, readable, incremental changes.
- Ask before expanding scope or adding dependencies.

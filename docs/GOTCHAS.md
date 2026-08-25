# Gotchas

## dsh Harness

- `~/.dsh/` contains the live harness and profile; **do not modify it**.
- dsh web plugins are browser modules loaded via `window.__ModuleLoader__.load(...)`. The client entry must be built into that format (e.g. `tsdown`).
- `sidebar.settings` is a `single` slot already occupied by `@deepseek-ai/dsh-client-ui-settings-general`.
- The Settings → Models page has **no per-provider slot**: slot outlets render as `<div data-slot="…">` anchors (see `dsh-client-ui-renderer`), and the Models section content is the only child of the `settings.section` outlet when active — anchor quote blocks on that stable structure, never on hashed CSS classes (`zGbnIq_*` change per build).
- Slot occupants render inside the settings dialog only while it is open; a `settings.action` occupant unmounts when the panel closes, so DOM observers tied to it need no manual cleanup beyond disconnect.
- Host-side plugin changes do **not** hot-load when the plugin is symlinked into a profile (the HMR watcher keys on the symlink path while the module cache holds the realpath) — keep host-side behavior additive/back-compatible, or plan a `dsh web` restart.
- Client bundles are served with `cache-control: no-cache` and a content-based `?rev=`; a rebuild + page refresh is enough to deploy client changes.
- A dsh bundle usually needs:
  - `package.json` with `dsh.bundle.patch` and `dsh.client.platform = "web"`
  - `cordis.patch.yml` inserting the plugin row
  - a built `lib/client.js` for the browser half
- Reference plugin to imitate: `dsh-ocgo-usage` (host routes + client polling + local JSON persistence).

## LLMRates.ai API

- Base URL: `https://www.llmrates.ai`
- Free, read-only, no API key, CORS enabled.
- Main endpoints: `/api/models`, `/api/models/{slug}`, `/api/providers`, `/api/providers/{slug}`, `/api/compare`, `/api/dataset`.
- Data is edge-cached; may be a few minutes stale.
- Use `sid` for stable model identity and compare.
- Price rows are per 1M tokens unless the field says otherwise.
- Not all models are token-priced; some have `videoPricePerSecond`, `imagePrice`, etc.

## Persistence / Privacy

- User data must stay local. Prefer `~/.dsh/llm-quotes.json` or a similar local file.
- No accounts, no telemetry, no cloud sync.
- If host-side routes are added, keep browser access same-origin only.

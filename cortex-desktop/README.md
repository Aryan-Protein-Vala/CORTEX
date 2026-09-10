# CORTEX desktop

A small native window over your own `cortex-core`: read and write memory, see what
the forgetting curve is doing, and let `cortex://` links from other tools open here.

It is **not** a second backend. Everything the window shows comes from the core's
HTTP API, called from Rust commands (so the webview never sees the API key and the
content security policy never has to allow a remote origin).

## Run it

```bash
# 1. the core must be running (this app talks to it, it does not embed it)
cd ../cortex-core && cargo run --release --bin cortex-core

# 2. the window
cd ../cortex-desktop
npm install                 # @tauri-apps/cli
npm run tauri dev           # rustup toolchain + Tauri 2 prerequisites required
```

Linux needs `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `libayatana-appindicator3-dev`,
`librsvg2-dev`; macOS needs Xcode's command line tools; Windows needs the MSVC
build tools and WebView2 (the installer bootstraps it).

Build installers with `npm run tauri build` — see *What you get* below for what is
honest about that output.

## Configuration

| Variable | Read by | Effect |
| --- | --- | --- |
| `CORTEX_API_URL` | Rust commands | Core address. Default `http://127.0.0.1:3030`. |
| `CORTEX_API_KEY` | Rust commands | Sent as `x-cortex-key` on every call. Needed when the core has a key. |
| `CORTEX_OWNER` | Rust commands | Namespace this window reads and writes. Default `cortex://default`. |

Set them in the environment you launch the app from (`CORTEX_API_KEY=… npm run tauri dev`).
The header line shows what resolved — including `no key` — because a wrong
assumption there is otherwise invisible until memory looks empty.

## What the window does

- **Remember** — one atomic fact per submit, `wait: true`, so the result says how
  many relations and nodes were created, or that nothing durable was found.
- **Recall** — the exact briefing a model would get, with token usage, whether it
  was truncated, and how many nodes were scanned.
- **Memories** — the namespace list with retention, impact, lock and fade flags,
  plus `keep`/`unlock` and a two-step `forget` (the only destructive action here).
- **`cortex://` deep links** — registered by the bundle. A link is resolved
  against the core and its context packet is shown in the window, which is brought
  to the front. Failures arrive as the core's own error text.

No core running? Every panel says `core_unreachable` and what to do about it.
Nothing here renders a placeholder number, because an empty-looking memory tool is
how people conclude their data is gone.

## What you get from `tauri build`

Installers for the platforms you build on (`.dmg`/`.app`, `.msi`/`.exe` NSIS,
`.deb`/`.rpm`/`.AppImage`). They are **unsigned and unnotarised**: macOS will show
Gatekeeper's warning and Windows SmartScreen will complain until you configure a
developer ID and an Apple notary service — those need paid certificates, which is
a release-infrastructure task, not a code change. There is **no auto-updater**
yet: `tauri-plugin-updater` needs a signed release feed, so updates today mean
rebuilding. `src-tauri/tauri.conf.json` sets `bundle.publisher` and per-OS
webview bootstrapping; `src-tauri/icons/*` are CORTEX's own (regenerate with
`./scripts/gen-icons.sh`, which replaces the create-tauri-app template artwork).

## Privacy

No telemetry, no crash reporter, no phone-home — the only network calls in this
app are the ones to the core you pointed it at, made from the Rust side. The
webview loads three local files.

## Licence

AGPL-3.0-or-later, like the rest of this repository.

# CORTEX — Chrome extension

Turns the conversations you already have in ChatGPT, Claude and Gemini into a
memory graph on **your own machine**, so the next tool you open — Cursor, Claude
Desktop, a script — already knows your stack, your rules and your decisions.

There is no CORTEX backend in this loop. The extension talks to one URL: the
`cortex-core` you run yourself.

## Install (developer mode, 60 seconds)

```bash
# 1. the core (this is the database — without it the extension stays idle)
cd ../cortex-core && cargo run --release --bin cortex-core

# 2. the extension
#    chrome://extensions → "Load unpacked" → select this folder
```

`npm test` in this folder runs the manifest validator and the logic tests (no
browser needed). To produce a Web Store upload, `npm run package` writes
`../dist/cortex-extension.zip`.

## What it does, per mode

| Mode | Reading | Writing to the AI site |
| --- | --- | --- |
| **remember** (default) | your turns + the assistant's, buffered and extracted into the core | nothing, ever |
| **composer** | same | inserts a block labelled `[CORTEX MEMORY — … safe to edit or delete]` at your cursor when **you** press `Alt+Shift+C` or the popup button |
| **request** (experimental) | same, read from the real request body | appends the memory block to the text part of the outgoing message |

`request` mode is called experimental because it depends on OpenAI's and Anthropic's
private endpoints; those change without notice. The hook will append to an existing
text part or do nothing — it never creates parts, never modifies image/code parts,
and passes the request through untouched if the shape is unexpected. Still: a site
terms-of-service may not like a client that alters requests. Read theirs; the default
mode exists because of that.

## Consent, pause, audit

- On first load in a supported tab you get a card: *Remember only* / *+ composer* /
  *Not now*. **Nothing is read before you choose.** Declining sets the extension to
  paused.
- The toolbar icon is the kill switch: click → **Pause**. While paused the content
  script neither reads nor sends, and any buffered turns are dropped or flushed
  (your choice, on the same button).
- "What CORTEX stored recently" in the popup is the real log: host, how many turns
  went in, how many facts came out, and the core's warnings. "Your memories" lists
  stored nodes with **keep** (protect from decay) and **forget** (delete node + its
  edges) on each row.
- To wipe everything: stop the core and delete `~/.cortex/cortex-graph.json`, or
  `curl -X DELETE http://127.0.0.1:3030/v1/memories/<id>` per memory.

## Data flow

```
DOM (or request body) → dedupe/budget in harvest-core.js → chrome.runtime message
   → service worker buffer (per tab, 45s idle or 30 turns)
   → POST /v1/session/message … /v1/flush on the core
   → extractor (LLM if OPENROUTER_API_KEY is set, else heuristics)
   → your graph file
```

Turns are buffered per tab so a 40-message conversation costs **one** extraction
pass, not forty. Only lines you wrote become "facts about you"; assistant replies
arrive tagged `ASSISTANT` and the core's extractor ignores them for that purpose —
which is the difference between a memory and a hallucination loop.

No analytics, no third-party requests, no `tabs` permission, no cookies read, no
history access. `host_permissions` covers only the core's localhost origin; a remote
core needs an origin you approve in the popup (optional permission, requested on click).

## Settings

| Field | Notes |
| --- | --- |
| Core URL | Default `http://127.0.0.1:3030`. `localhost` also works. |
| API key | Only if the core runs with `CORTEX_API_KEY`; sent as `x-cortex-key`. |
| Owner namespace | `cortex://me` keeps this browser's graph separate from your MCP's. Normalised by the core. |
| Token budget | Cap for injected context (the core clamps it to its own max). |
| Idle flush | 10–600s. Lower = facts appear sooner, more extraction calls. |

## Troubleshooting

| Symptom | Meaning |
| --- | --- |
| Badge shows `!` | The core rejected a send — usually 401 (key mismatch) or the core is on another port. The popup status line says which. |
| "no conversation detected on this page" | The site's markup changed. Harvesting is off until it matches again; nothing else breaks. |
| Facts from a chat never show up | The text had nothing durable in it (extraction is not transcription). Check "What CORTEX stored recently" — `0 fact(s)` with a warning means the extractor declined. |
| Memory looks empty after reinstall | The graph lives in the core's data dir, not in `chrome.storage`. Re-point the Core URL at the machine that has it. |

## Privacy policy (copy for the Web Store listing)

CORTEX reads the conversation content of chatgpt.com, claude.ai and
gemini.google.com tabs **only after explicit opt-in**, and sends it only to a URL
the user configures, defaulting to `http://127.0.0.1:3030` on the user's own
machine. The extension has no server, no analytics and no third-party requests.
Stored memories persist in the user's own data directory and can be listed,
locked or deleted from the popup. Remote-usage disclosure: none — if a user points
the Core URL at another host, that is their own infrastructure choice.

## Licence

AGPL-3.0-or-later, like the rest of this repository.

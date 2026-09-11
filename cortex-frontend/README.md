

## Deploying this site (Vercel)

The repo is a monorepo, so Vercel needs to be told *where* the Next app is. A project whose
**Root Directory** is the repository root fails in about 0 seconds with no build log — which is what
the `Vercel` check on a PR looks like when it fails instantly and `previewUrl` comes back empty.

1. Vercel → Project `cortex-frontend` → **Settings → General → Root Directory → Edit → `cortex-frontend`** → Save.
2. Redeploy the failed commit.
3. `vercel.json` in this directory already pins `framework: nextjs`, `npm run build` and `.next`.

Environment variables this site needs (all server-side unless the name says otherwise):

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | public | canonical URL for metadata + Open Graph; wrong value = broken link previews |
| `CORTEX_API_URL` | server | where `/api/core/*` proxies to. A public deployment needs a core the visitor can reach, which for almost everyone means **leave it unset** and the dashboard shows "no core configured" instead of pretending |
| `CORTEX_API_KEY` | server | sent by the proxy only; never shipped to the browser |
| `CORTEX_CONTACT_FILE` | server | where the contact form appends JSONL; serverless filesystems are ephemeral, so expect a `503` there unless it points at a mounted volume |
| `NEXT_PUBLIC_CORTEX_WS_URL` | public | live brain feed; opt-in |
| `NEXT_PUBLIC_SITE_ANALYTICS` | public | set to `1` to load Vercel Analytics. Off by default, and the privacy page says so |

Nothing here should ever receive a key you are not willing to rotate: the dashboard is a client of
*your* core, not of a service I run.


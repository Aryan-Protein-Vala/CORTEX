## What changes

<!-- One paragraph: the behaviour that is different after this. -->

## Why

<!-- Link the issue, or state the bug/limitation this removes. "It looked nicer" is a valid reason here, but say it as that. -->

## Verification

Run the ones that apply and paste the tail, not just "tests pass":

- [ ] `node scripts/verify-all.mjs --install` — every suite, and it names what it could not run
- [ ] `cd cortex-core && cargo test` — required for anything touching ids, owners, budget, decay or auth
- [ ] `cd cortex-mcp && npm test` — required for tool/schema/error-semantics changes
- [ ] `cd cortex-extension && npm test` — required for capture, consent or injection changes
- [ ] `cd cortex-frontend && npm run verify` — required for anything in `app/` or `lib/`
- [ ] `node scripts/check-versions.mjs` — required if any manifest changed
- [ ] Manual: Chrome `Load unpacked` pass / Windows PowerShell installer run, where a suite cannot cover it

## Honesty checklist

The rules that got this repo audited in the first place:

- [ ] No new capability claim in README/docs/landing/legal that the code does not implement.
- [ ] Nothing deleted or overwritten silently: memory deletion stays explicit, IDE configs stay merged.
- [ ] Errors use real statuses and codes (501 when unwired, 401/403 for auth, `isError` for MCP).
- [ ] A new bug class comes with a test that fails before the fix.
- [ ] `node:node:`-style id drift is impossible: ids come only from `types::{node_id_for_label, canonical_node_id, edge_id_for}`.

## Notes for the reviewer

<!-- Known gaps, follow-ups, anything you deliberately left broken or half-done. -->

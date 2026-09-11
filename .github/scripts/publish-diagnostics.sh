#!/usr/bin/env bash
# Publish cargo diagnostics through whatever channel this environment can actually read.
#
# Background: the Actions *log files* are served from results-receiver.actions.githubusercontent.com
# and Azure blob storage, both of which die with a TLS EOF from where this branch is developed.
# api.github.com works. So the diagnostics get pushed at the API from inside the runner, in order
# of payload size, and each attempt reports whether it worked:
#
#   1. a check run on the commit          — 64 KB of markdown, readable via /commits/:sha/check-runs
#   2. a comment on the pull request       — same text, needs pull-requests: write
#   3. check-run annotations               — tiny, single-line, but always visible in the UI
#
# Nothing here may fail the job (the caller keeps continue-on-error), and nothing may depend on
# the ambient working directory: the core job sets `working-directory: cortex-core`, which is what
# made the first version of this reporting exit 127 ("command not found") and explain nothing.
set +e +u -o pipefail

here=$(cd "$(dirname "$0")" && pwd)
repo="${GITHUB_REPOSITORY:-}"
sha="${GITHUB_SHA:-}"
pr="${PR_NUMBER:-}"
tag="${1:-cargo diagnostics}"
shift 2>/dev/null
logs=("$@")

if [ "${#logs[@]}" -eq 0 ]; then
  logs=(/tmp/fmt.log /tmp/clippy.log /tmp/test.log /tmp/build.log /tmp/check.log)
fi

body=""
for f in "${logs[@]}"; do
  [ -s "$f" ] || continue
  body+=$(printf '### %s (%s bytes)\n\n```text\n' "$f" "$(wc -c <"$f")")
  body+=$'\n'
  body+=$(sed -e 's/\x1b\[[0-9;]*m//g' "$f" | tail -c 14000)
  body+=$'\n```\n\n'
done
[ -n "$body" ] || body="No log was captured. Either the step that tees it did not run, or tee could not write /tmp."

status="check-run=skip"
comment="comment=skip"

# 1. check run
if [ -n "$repo" ] && [ -n "$sha" ] && command -v jq >/dev/null 2>&1; then
  payload=$(jq -Rs --arg sha "$sha" --arg tag "$tag" '
    {name: ("diagnostics: " + $tag),
     head_sha: $sha,
     status: "completed",
     # neutral, so a diagnostics check can never turn a green build red or block a merge
     conclusion: "neutral",
     output: {title: $tag, summary: ., text: "Raw cargo output, published because the Actions log endpoints are unreachable from the authoring environment."}}' <<<"$body")
  if [ -n "$payload" ] && printf '%s' "$payload" | gh api -X POST "repos/$repo/check-runs" --input=- >/tmp/diag-checkrun.json 2>&1; then
    status="check-run=ok"
  else
    status="check-run=failed($(tail -c 120 /tmp/diag-checkrun.json | tr -d '\n\r' | cut -c1-60))"
  fi
fi

# 2. PR comment (only when the check run did not land, so the PR is not spammed twice)
if [ "$status" != "check-run=ok" ] && [ -n "$repo" ] && [ -n "$pr" ]; then
  printf '%s\n' "## ${tag} (published from the runner; Actions logs are not downloadable here)" \
    "" "$body" > /tmp/diag-comment.md
  if gh pr comment "$pr" --repo "$repo" --body-file /tmp/diag-comment.md >/tmp/diag-comment.log 2>&1; then
    comment="comment=ok"
  else
    comment="comment=denied"
  fi
fi

# 3. annotations, always: tiny summary of what happened plus the first errors, ASCII-only so the
#    workflow-command parser cannot choke on it.
first=$(printf '%s' "$body" | sed -e 's/\x1b\[[0-9;]*m//g' | grep -aE '(error|warning)(\[E[0-9]+\])?:|test result:|panicked at|failures:' \
  | head -6 | tr -d '\r' | tr '\n' ' ' | tr -c '[:print:]' ' ' \
  | sed -e 's/%/%25/g' -e 's/::/%3A%3A/g' | cut -c1-900)
printf '::error title=%s::%s\n' "$tag" "${first:-no diagnostic lines found}"
printf '::notice title=diagnostics channels::%s %s\n' "$status" "$comment"
exit 0

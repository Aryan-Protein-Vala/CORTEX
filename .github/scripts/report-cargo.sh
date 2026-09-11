#!/usr/bin/env bash
# Turn cargo's output into check-run annotations.
#
# Why this exists: the Actions log *files* are downloaded from
# results-receiver.actions.githubusercontent.com plus Azure blob storage, and neither is
# reachable from the environment this repo is developed in (both die with a TLS EOF). The REST
# API for check runs *is* reachable, and its annotations carry whatever a step echoed with
# ::error::. So the Rust diagnostics come back as annotations instead of being invisible.
#
# Two formats have to work here, because cargo renders diagnostics differently depending on
# --message-format: the human default (`error[E0308]: msg` on its own line) and `short`
# (`src/file.rs:12:5: error: msg`). Anchoring on ^error silently drops every real error in the
# `short` form — the first draft of this script did exactly that, and a synthetic log caught it.
#
# Each annotation is a single line: the workflow-command parser ends the message at the first
# newline, and `%` / `::` must be percent-encoded or they read as command syntax.
#
# Usage: report-cargo.sh [logfile...]     (defaults to /tmp/{fmt,clippy,test,check}.log)
set -uo pipefail

files=("$@")
if [ "${#files[@]}" -eq 0 ]; then
  files=(/tmp/fmt.log /tmp/clippy.log /tmp/test.log /tmp/check.log)
fi

strip_ansi() { sed -e 's/\x1b\[[0-9;]*m//g'; }

# Collapse to one line and escape what GitHub would otherwise parse as command syntax.
flatten() {
  sed -e 's/%/%25/g' -e 's/::/%3A%3A/g' | tr '\r\n' '  ' | sed -e 's/[[:space:]]\{2,\}/ | /g'
}

emit() { # $1 title, $2 level, $3 body
  local title="$1" level="$2" body="$3"
  [ -n "$body" ] || return 0
  # Cap below the annotation size limit so a giant log can never fail the run by itself.
  printf '::%s title=%s::%s\n' "$level" "$title" "${body:0:3000}"
}

DIAG='(error|warning)(\[E[0-9]+\])?:'

for f in "${files[@]}"; do
  [ -f "$f" ] || continue
  [ -s "$f" ] || continue

  case "$f" in
    *fmt*)
      # cargo fmt --check prints the diff it wants applied, which is what a toolchain-less
      # environment needs in order to fix the formatting by hand.
      emit "cargo fmt diff" error "$(strip_ansi <"$f" | grep -E '^Diff in' -A 10 | head -c 4000 | flatten)"
      ;;
    *clippy*)
      hits=$(strip_ansi <"$f" | grep -cE "$DIAG")
      emit "clippy ($hits diagnostics)" error "$(strip_ansi <"$f" | grep -E "$DIAG" -A 4 | head -c 4000 | flatten)"
      ;;
    *test*)
      emit "cargo test" error "$(strip_ansi <"$f" | grep -E "$DIAG|test result:|failures:" -A 6 | head -c 4000 | flatten)"
      ;;
    *build*)
      emit "cargo build --release" error "$(strip_ansi <"$f" | grep -E "$DIAG" -A 6 | head -c 4000 | flatten)"
      ;;
    *check*)
      emit "cargo check" error "$(strip_ansi <"$f" | grep -E "$DIAG" -A 6 | head -c 4000 | flatten)"
      ;;
    *)
      # The core binary's own stdout when a smoke test fails: not a rustc diagnostic, so just
      # the head of it, cleaned the same way.
      emit "cargo output ($f)" error "$(strip_ansi <"$f" | head -c 4000 | flatten)"
      ;;
  esac
done

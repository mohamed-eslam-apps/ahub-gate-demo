#!/usr/bin/env bash
# Simulates the Jenkins promotion step: ask the gate, deploy to prod, confirm.
# Usage: scripts/release.sh [commit] [--check-only] [--no-confirm] [--skip-gate]
#                           [--break-glass "<reason>" [--cause ahUnreachable|versionUnresolvable]]
. "$(dirname "$0")/lib.sh"
load_env

commit=HEAD confirm=1 skip_gate=0 check_only=0 break_glass="" cause=ahUnreachable
while [ $# -gt 0 ]; do
  case $1 in
    --check-only) check_only=1 ;;
    --no-confirm) confirm=0 ;;
    --skip-gate) skip_gate=1 ;;
    --break-glass) break_glass=${2:?reason required}; shift ;;
    --cause) cause=${2:?}; shift ;;
    -*) echo "unknown flag $1" >&2; exit 2 ;;
    *) commit=$1 ;;
  esac
  shift
done
sha=$(resolve_sha "$commit")
git push -q origin "$sha:refs/heads/main" 2>/dev/null || true

if [ "$skip_gate" = 1 ]; then
  echo "!! Skipping the gate entirely (expect an 'ungated' alert after the grace period)"
  exec "$(dirname "$0")/deploy.sh" prod "$sha"
fi

if [ -n "$break_glass" ]; then
  body=$(jq -nc --arg p "$AHUB_PRODUCT" --arg c "$AHUB_COMPONENT" --arg s "$sha" \
    --arg r "$break_glass" --arg a "$AHUB_ACTOR" --arg cause "$cause" \
    '{product:$p, component:$c, commitSha:$s, reason:$r, actor:$a, cause:$cause}')
  check_id=$(api POST /ci/gate/break-glass "$body" | jq -r '.checkId')
  echo "Break-glass recorded: check $check_id"
else
  q="product=$(jq -rn --arg v "$AHUB_PRODUCT" '$v|@uri')&component=$AHUB_COMPONENT&commitSha=$sha"
  res=$(api GET "/ci/gate?$q")
  echo "$res" | jq -C '{checkId, verdict, reasons, componentHash, missingTests, failingTests, quarantinedTests, flakyTests, matchedRunIds, breakGlassAllowed, override}'
  check_id=$(echo "$res" | jq -r '.checkId')
  verdict=$(echo "$res" | jq -r '.verdict')
  has_override=$(echo "$res" | jq -r '.override != null')
  if [ "$verdict" != pass ] && [ "$has_override" != true ]; then
    echo "Gate blocked ${sha:0:7} ($verdict). Not deploying." >&2
    exit 1
  fi
  if [ "$check_only" = 1 ]; then echo "Gate allows ${sha:0:7} ($verdict). --check-only: not deploying."; exit 0; fi
fi

"$(dirname "$0")/deploy.sh" prod "$sha"

if [ "$confirm" = 1 ]; then
  body=$(jq -nc --arg s "$sha" --arg a "$AHUB_ACTOR" '{usedSha:$s, actor:$a}')
  api POST "/ci/gate/checks/$check_id/confirm" "$body" >/dev/null
  echo "Confirmed check $check_id"
else
  echo "!! Not confirming (expect an 'unconfirmed' alert after the grace period)"
fi

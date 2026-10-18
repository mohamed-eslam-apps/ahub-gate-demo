#!/usr/bin/env bash
# Trigger a test run on the test environment the way a pipeline would,
# reporting which commit is deployed there (subjectVersions).
# Usage: scripts/ci-run.sh [commit|--no-subject] [extra jq fields, e.g. '{tags:["@smoke"]}']
# Default commit: whatever /test/version.json serves right now.
. "$(dirname "$0")/lib.sh"
load_env
: "${AHUB_TEST_REPO_ID:?set AHUB_TEST_REPO_ID (test repo id) in .env.local}"
: "${AHUB_TEST_ENV_ID:?set AHUB_TEST_ENV_ID (test environment id) in .env.local}"

arg=${1:-}
extra=${2:-'{}'}
if [ "$arg" = --no-subject ]; then
  subject='[]'
else
  sha=${arg:-$(curl -fsS "$(pages_base)/test/version.json?ts=$(date +%s%N)" | jq -r .commitSha)}
  sha=$(resolve_sha "$sha" 2>/dev/null || echo "$sha")
  subject=$(jq -nc --arg c "$AHUB_COMPONENT" --arg s "$sha" '[{component:$c, commitSha:$s}]')
fi

body=$(jq -nc --arg r "$AHUB_TEST_REPO_ID" --arg e "$AHUB_TEST_ENV_ID" --argjson sv "$subject" --argjson x "$extra" \
  '{repoId:$r, environmentIds:[$e]} + (if ($sv|length) > 0 then {subjectVersions:$sv} else {} end) + $x')
api POST /ci/runs "$body" | jq -C 'if type=="array" then map({id, status}) else {id, status} end'

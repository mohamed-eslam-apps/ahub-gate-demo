#!/usr/bin/env bash
# Ask the gate about one commit without deploying anything.
# Usage: scripts/gate-check.sh <commit|sha> [component] [product]
. "$(dirname "$0")/lib.sh"
load_env
sha=$(resolve_sha "${1:?commit}" 2>/dev/null || echo "$1")
component=${2:-$AHUB_COMPONENT}
product=${3:-$AHUB_PRODUCT}
q="product=$(jq -rn --arg v "$product" '$v|@uri')&component=$component&commitSha=$sha"
api GET "/ci/gate?$q" | jq '{verdict, reasons, componentHash: (.componentHash // "" | .[0:12]), matchedRunIds, failingTests, missingTests, quarantinedTests, override: (.override != null)}'

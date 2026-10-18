# Shared helpers for deploy.sh / release.sh / ci-run.sh. Sourced, not run.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

# https://<owner>.github.io/<repo> from the origin remote.
pages_base() {
  local url owner repo
  url=$(git remote get-url origin)
  url=${url%.git}
  repo=${url##*/}
  owner=${url%/*}
  owner=${owner##*[/:]}
  echo "https://${owner}.github.io/${repo}"
}

load_env() {
  [ -f .env.local ] || { echo "Missing .env.local (copy .env.local.example)" >&2; exit 2; }
  # shellcheck disable=SC1091
  set -a; . ./.env.local; set +a
  : "${AHUB_URL:?set AHUB_URL in .env.local}"
  : "${AHUB_TOKEN:?set AHUB_TOKEN in .env.local}"
  AHUB_PRODUCT=${AHUB_PRODUCT:-Gate Demo}
  AHUB_COMPONENT=${AHUB_COMPONENT:-web}
  AHUB_ACTOR=${AHUB_ACTOR:-${USER:-release-script}}
}

# api METHOD PATH [JSON_BODY] -> prints the envelope's .data; exits 1 on HTTP >= 400.
api() {
  local method=$1 path=$2 body=${3:-} out status
  out=$(mktemp)
  status=$(curl -sS -o "$out" -w '%{http_code}' -X "$method" "${AHUB_URL%/}/api/v1${path}" \
    -H "Authorization: Bearer ${AHUB_TOKEN}" \
    -H "x-ahub-actor: ${AHUB_ACTOR}" \
    ${body:+-H "Content-Type: application/json" --data "$body"})
  if [ "$status" -ge 400 ]; then
    echo "HTTP $status on $method $path" >&2
    jq -C '{message, errors: (.errors // .data // null)}' "$out" >&2 2>/dev/null || cat "$out" >&2
    rm -f "$out"
    return 1
  fi
  jq '.data' "$out"
  rm -f "$out"
}

resolve_sha() { git rev-parse "${1:-HEAD}^{commit}"; }

#!/usr/bin/env bash
# Publish app/ at a commit to GitHub Pages under /test or /prod.
# Usage: scripts/deploy.sh <test|prod> [commit]   (default commit: HEAD)
# The deployed bytes come from `git archive <commit> app`, never the working
# tree, so what is served is exactly what the gate hashed.
. "$(dirname "$0")/lib.sh"

env=${1:?usage: deploy.sh <test|prod> [commit]}
[[ $env == test || $env == prod ]] || { echo "env must be test or prod" >&2; exit 2; }
sha=$(resolve_sha "${2:-HEAD}")
git push -q origin "$sha:refs/heads/main" 2>/dev/null || true # GitHub must know the commit

rm -rf .deploy && git worktree prune
if git ls-remote --exit-code --heads origin gh-pages >/dev/null 2>&1; then
  git fetch -q origin gh-pages
  git worktree add -q -B gh-pages .deploy origin/gh-pages
else
  git worktree add -q --detach .deploy
  git -C .deploy checkout -q --orphan gh-pages
  git -C .deploy rm -rfq . >/dev/null 2>&1 || true
fi

rm -rf ".deploy/$env" && mkdir -p ".deploy/$env"
git archive "$sha" app | tar -x --strip-components=1 -C ".deploy/$env"
printf '{"component":"web","commitSha":"%s","imageDigest":null}\n' "$sha" > ".deploy/$env/version.json"
touch .deploy/.nojekyll
printf '<!doctype html><title>Gate Demo</title><a href="test/">test</a> · <a href="prod/">prod</a>\n' > .deploy/index.html

git -C .deploy add -A
git -C .deploy commit -qm "deploy $env ${sha:0:7}" || echo "nothing changed on gh-pages"
git -C .deploy push -q origin gh-pages
git worktree remove --force .deploy

url="$(pages_base)/$env/version.json"
echo "Pushed ${sha:0:7} to $env. Waiting for $url ..."
for _ in $(seq 1 60); do
  live=$(curl -fsS "$url?ts=$(date +%s%N)" 2>/dev/null | jq -r '.commitSha' 2>/dev/null || true)
  if [ "$live" = "$sha" ]; then echo "Live on $env: ${sha:0:7}"; exit 0; fi
  sleep 5
done
echo "Timed out waiting for Pages (last seen: ${live:-nothing})" >&2
exit 1

# ahub-gate-demo

Throwaway app for exercising the Automation Hub **release gate** end to end.

- `app/` — the deployed static site (component `web`, path `app`).
- `tests/` — Playwright suite; `@smoke` tests are read-only and safe on prod.
- `scripts/deploy.sh <test|prod> [commit]` — publish to GitHub Pages:
  `https://mohamed-eslam-apps.github.io/ahub-gate-demo/{test,prod}/`.
- `scripts/ci-run.sh` — trigger a test-env run with `subjectVersions`.
- `scripts/release.sh [commit] [--no-confirm|--skip-gate|--break-glass "why"]`
  — gate check → prod deploy → confirm (what Jenkins would do).

Copy `.env.local.example` to `.env.local` and fill in the token. Needs `jq`, `curl`, `git`.

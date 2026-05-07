# CI Map

Run these local commands before relying on the matching GitHub workflow.

| Workflow | Local command |
| --- | --- |
| Suite CI / contract | `node --test scripts/tests/*.test.mjs && node scripts/validate-suite-config.mjs --require-local-repos && node scripts/check-suite-repos.mjs && node scripts/generate-suite-protocol.mjs --check && node scripts/smoke-suite-contracts.mjs && node scripts/check-automation-boundary.mjs && node scripts/check-windows-suite-scripts.mjs` |
| Suite CI / integration-smoke | `./scripts/smoke-all.sh` |
| Suite CI / windows-launchers | `.\scripts\clone-or-update-apps.ps1; node scripts/check-suite-repos.mjs; node scripts/check-windows-suite-scripts.mjs --require-pwsh; node --test scripts/tests/windows-manifest.test.mjs scripts/tests/windows-readme-template.test.mjs` |
| Suite release gate | `node scripts/release-preflight.mjs && node scripts/check-ci-status.mjs --require-green` |
| Suite release dry-run | `./scripts/release-dry-run.sh --skip-remote` |
| Packaged app boot smoke | `node scripts/smoke-packaged-app-boot.mjs --apps-dir dist/mac-suite-apps` |
| Release readiness report | `node scripts/release-readiness-report.mjs --artifact-dir dist/mac-suite --check` |
| Studio CI | `npm run ci` |
| Pulse CI | `pnpm run ci` |
| Console CI | `npm run ci` |

`./scripts/smoke-all.sh` delegates to each app's own aggregate CI script after
running Suite contract checks, so local integration smoke and app workflows use
the same gates.

Use `node scripts/print-ci-summary.mjs` for a compact GitHub Actions table, and
`node scripts/changes-since-green.mjs` to list local commits that have not yet
been covered by the latest green CI run for each repo.

`node scripts/check-automation-boundary.mjs` audits intentional placeholders and
manual validation blockers tracked in `suite/automation-boundary.json`. The
release readiness report includes that audit so code-only gates stay distinct
from Twitch OAuth/chat checks and macOS permission/trust checks.

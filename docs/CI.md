# CI Map

Run these local commands before relying on the matching GitHub workflow.

| Workflow | Local command |
| --- | --- |
| Suite CI / contract | `node --test scripts/tests/*.test.mjs && node scripts/validate-suite-config.mjs --require-local-repos && node scripts/check-suite-repos.mjs && node scripts/generate-suite-protocol.mjs --check && node scripts/smoke-suite-contracts.mjs && node scripts/check-windows-suite-scripts.mjs` |
| Suite CI / integration-smoke | `./scripts/smoke-all.sh` |
| Suite CI / windows-launchers | `node scripts/check-windows-suite-scripts.mjs --require-pwsh` |
| Suite release gate | `node scripts/release-preflight.mjs && node scripts/check-ci-status.mjs --require-green` |
| Studio CI | `npm run ci` |
| Pulse CI | `pnpm run ci` |
| Console CI | `npm run ci` |

`./scripts/smoke-all.sh` delegates to each app's own aggregate CI script after
running Suite contract checks, so local integration smoke and app workflows use
the same gates.

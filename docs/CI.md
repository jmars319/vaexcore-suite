# CI Map

Run these local commands before relying on the matching GitHub workflow.

| Workflow | Local command |
| --- | --- |
| Suite CI / contract | `node --test scripts/tests/*.test.mjs && node scripts/validate-suite-config.mjs --require-local-repos && node scripts/check-suite-repos.mjs && node scripts/generate-suite-protocol.mjs --check && node scripts/smoke-suite-contracts.mjs && node scripts/check-windows-suite-scripts.mjs` |
| Suite CI / integration-smoke | `./scripts/smoke-all.sh` |
| Suite release gate | `node scripts/release-preflight.mjs && node scripts/check-ci-status.mjs --require-green` |
| Studio CI | `npm run test:scripts && npm run prepare:sidecars && npm run check:sidecars && cargo fmt --all -- --check && cargo test -p vaexcore-api && cargo test -p vaexcore-studio-desktop && npm run typecheck` |
| Pulse CI | `pnpm run lint && pnpm --filter @vaexcore/pulse-desktopapp typecheck && pnpm run smoke:studio && (cd apps/desktopapp/src-tauri && cargo fmt --all -- --check && cargo test)` |
| Console CI | `npm run typecheck && npm run smoke:studio` |

Console currently has no dedicated lint or format script. Add one before wiring
style checks into Console CI.

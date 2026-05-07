# Release Readiness

The suite now separates code-verifiable release gates from checks that still
need a real operator machine or live service.

## Code-Verifiable Gates

Run these before treating a release candidate as mechanically ready:

```bash
node --test scripts/tests/*.test.mjs
node scripts/validate-suite-config.mjs --require-local-repos
node scripts/check-suite-repos.mjs
node scripts/generate-suite-protocol.mjs --check
node scripts/smoke-suite-contracts.mjs
node scripts/check-automation-boundary.mjs
node scripts/check-windows-suite-scripts.mjs
./scripts/release-dry-run.sh --skip-remote
node scripts/release-readiness-report.mjs --artifact-dir dist/mac-suite --check
```

For staged macOS app bundles, run the packaged boot smoke against the directory
that contains `vaexcore studio.app`, `vaexcore pulse.app`, and
`vaexcore console.app`:

```bash
node scripts/smoke-packaged-app-boot.mjs --apps-dir /Applications
```

The boot smoke launches each bundle with an isolated temporary `HOME`, waits for
Suite discovery heartbeat files, validates those heartbeats, then terminates the
launched processes. It does not use live Twitch, camera, microphone, or system
audio services.

## Tracked Automation Boundary

`suite/automation-boundary.json` is the source of truth for work that is not
mistaken for release-complete behavior:

- Intentional code placeholders: offline STT, timeline-level edit alignment,
  Studio GStreamer/system-audio capture, and AI assist.
- Manual validation blockers: Twitch OAuth/live chat and macOS permission,
  signing, trust, and notarization behavior on a real machine.

`node scripts/check-automation-boundary.mjs` verifies that each entry still has
checked-in evidence. `node scripts/release-readiness-report.mjs` includes those
items as warnings and manual blockers instead of silently passing them.

## Notarization Environment

Unsigned local builds are allowed by default. Signing and notarization become
strict only when enabled:

```bash
VAEXCORE_MAC_SIGN=1 node scripts/check-release-env.mjs
VAEXCORE_MAC_NOTARIZE=1 node scripts/check-release-env.mjs
```

When notarization is enabled, the script requires the signing identity, Apple
ID, app-specific password, and 10-character Apple team ID. These checks only
validate environment shape; Apple trust policy still needs a real notarization
submission and first-launch check.

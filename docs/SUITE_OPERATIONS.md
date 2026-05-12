# vaexcore suite operations

This document preserves the script-heavy suite operations reference that previously lived in the root README. The root README now provides the high-level project presentation layer.

This repo is the orchestration and distribution layer for the independent
vaexcore apps and services:

- `studio`: local recording, streaming, and connected-app control layer
- `pulse`: local video review and highlight selection app
- `console`: Twitch operations bot and chat marker source
- `relay`: Cloudflare Worker service for Twitch chatbot identity, Discord interactions, and webhook transport

The app source stays in its own repos. This suite repo owns launchers, shared
protocol docs, build/install scripts, and release packaging helpers.

## App Repos

```text
studio          https://github.com/jmars319/vaexcore-studio
pulse           https://github.com/jmars319/vaexcore-pulse
console https://github.com/jmars319/vaexcore-console
relay          https://github.com/jmars319/vaexcore-relay
```

Clone or update the local app repos:

```bash
./scripts/clone-or-update-apps.sh
./scripts/clone-or-update-apps.sh --include-services
```

```powershell
.\scripts\clone-or-update-apps.ps1
.\scripts\clone-or-update-apps.ps1 -IncludeServices
```

## Scripts

```bash
./scripts/smoke-all.sh
```

Validates the suite config/schema contract, then runs the focused integration
smoke checks for Studio, Pulse, and Console.

```bash
./scripts/check-all.sh
```

Runs config validation, all smoke checks, and a macOS staging distribution build
with release manifest validation. Useful flags:

```bash
./scripts/check-all.sh --skip-app-smoke
./scripts/check-all.sh --skip-package
./scripts/check-all.sh --manifest-only --artifact-dir dist/mac-suite
```

Set `VAEXCORE_SKIP_MAC_PACKAGE=1` to skip the packaging step through the
environment.

```bash
./scripts/dev-all.sh
```

Starts the three local dev surfaces:

- Studio desktop web dev: `http://127.0.0.1:1420`
- Pulse desktop web dev: `http://127.0.0.1:1421`
- Console setup server: `http://127.0.0.1:3434`

Studio's local API defaults to `http://127.0.0.1:51287`. Pulse and Console use
Studio's discovery file or `VAEXCORE_STUDIO_API_URL` / `VITE_VAEXCORE_STUDIO_API_URL`
when launched outside the packaged desktop apps.

```bash
./scripts/install-apps.sh
```

Builds the three macOS app bundles and installs them as:

- `/Applications/vaexcore studio.app`
- `/Applications/vaexcore pulse.app`
- `/Applications/vaexcore console.app`

Each app has a Launch Suite button and app-menu item that opens all three
installed apps through macOS LaunchServices. The install script finishes by
running:

```bash
./scripts/verify-apps.sh
```

That verifier checks the installed app bundles and expected bundle identifiers.
`install-apps.sh` also supports `--dest <dir>`, `--skip-build`,
`--keep-artifacts`, `--no-verify`, and `--strict-heartbeat` for staging and CI
flows.

```bash
./scripts/dist-mac-suite.sh
```

Stages the three macOS app bundles under `dist/mac-suite/`, packages each app as
a zip with a SHA-256 file, and writes `dist/mac-suite/manifest.json`.

```bash
./scripts/release-suite.sh
```

Runs the release wrapper for the macOS suite: checks, staging build, checksums,
manifest validation, and a final artifact list.

```bash
node scripts/inspect-mac-artifacts.mjs --artifact-dir dist/mac-suite
```

Unzips the macOS suite artifacts into temporary folders and verifies each
extracted `.app` bundle identifier, version, executable, icon, and code
signature against `suite/contract.json`.

```bash
node scripts/check-release-artifacts.mjs --artifact-dir dist/mac-suite
```

Runs release manifest validation and macOS artifact inspection without
rebuilding the apps.

```bash
node scripts/check-release-env.mjs
```

Checks whether the current shell has the Apple signing and notarization
variables required when `VAEXCORE_MAC_SIGN=1` or `VAEXCORE_MAC_NOTARIZE=1`.

```bash
node scripts/check-automation-boundary.mjs
```

Audits `suite/automation-boundary.json`, which tracks intentional placeholders
and manual validation blockers that automation should not treat as complete.

```bash
node scripts/release-readiness-report.mjs --artifact-dir dist/mac-suite --check
```

Combines git cleanliness, version alignment, artifact manifest validation,
automation-boundary status, and GitHub CI status into one release-readiness
report. Use `--skip-remote` for local-only checks and `--skip-git` for fixture
tests.

```bash
node scripts/smoke-packaged-app-boot.mjs --apps-dir /Applications
```

Launches installed macOS app bundles against an isolated temporary `HOME` and
verifies that Suite discovery heartbeat files are created without touching live
Twitch, camera, microphone, or system-audio services.

```bash
node scripts/bump-suite-version.mjs --version 0.1.1
```

Updates `suite/release.json` with a new suite version and the current app
compatibility matrix.

```bash
node scripts/generate-suite-protocol.mjs
```

Regenerates shared TypeScript/Rust constants from `suite/contract.json`.
`smoke-all.sh` checks that generated protocol files are current.

```bash
node scripts/check-windows-suite-scripts.mjs
```

Runs static guards for the Windows PowerShell scripts and `.cmd` launchers, then
parses the PowerShell scripts when `pwsh` is installed. CI runs this with
`--require-pwsh` so parser coverage cannot silently downgrade on the hosted
runner.

```bash
node scripts/check-suite-repos.mjs
```

Verifies that local app repos are checked out on their configured branch, track
`origin/main`, and point at the expected GitHub origin. Suite CI runs this after
cloning the app repos.

```bash
node scripts/check-ci-status.mjs
node scripts/check-ci-status.mjs --require-green
```

Prints the latest `main` CI run for Suite, Studio, Pulse, and Console. The
`--require-green` form is the code-only gate to run before release packaging.

```powershell
.\suite\windows\Build-VaexcoreSuite.ps1
```

On Windows, builds the three Windows desktop artifacts and collects them under
`dist\windows-suite\`. Use `-InstallPrerequisites` on a fresh Windows 11 machine
to install common build prerequisites through `winget`. The script will clone or
update the three app repos before building unless `-SkipAppUpdate` is passed.
The generated README content in the PowerShell build script uses literal
here-strings so Markdown code fences do not get parsed as PowerShell escapes.

The Windows kit also includes double-clickable launchers:

```text
suite\windows\Install-VaexcoreLaunchers.vbs
suite\windows\Start-VaexcoreSuite.vbs
suite\windows\Start-VaexcoreStudio.vbs
suite\windows\Start-VaexcorePulse.vbs
suite\windows\Start-VaexcoreConsole.vbs
```

`Install-VaexcoreLaunchers.vbs` creates Start Menu shortcuts and a desktop
`vaexcore suite` shortcut using the suite logo.

## Suite Contract

`suite/contract.json` is the local operator contract for how the three apps fit
together. It records app IDs, bundle IDs, discovery filenames, health endpoints,
platform install locations, and the Studio-to-Pulse handoff filename.

## Release Gate

Before packaging a suite release, use this order:

```bash
./scripts/check-all.sh --skip-package
git push origin main
node scripts/release-preflight.mjs
node scripts/check-ci-status.mjs --require-green
./scripts/release-suite.sh
```

`release-preflight.mjs` verifies the Suite, Studio, Pulse, and Console repos are
clean, on `main`, pushed to `origin/main`, and green in GitHub Actions.
See `docs/RELEASE_READINESS.md` for the current split between code-verified
gates and real-world validation blockers.

## Suite Discovery

Packaged apps publish heartbeat files in:

```text
~/Library/Application Support/vaexcore/suite/
%APPDATA%\vaexcore\suite\
```

Studio reads those files for the Suite Status panel and checks whether each app
is installed in the platform app folder, has a running process, and exposes its
local health endpoint.

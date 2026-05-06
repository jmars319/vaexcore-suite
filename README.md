# vaexcore Suite

This repo is the orchestration and distribution layer for the three independent
vaexcore apps:

- `studio`: local recording, streaming, and connected-app control layer
- `pulse`: local video review and highlight selection app
- `console/VaexCore`: Twitch operations bot and chat marker source

The app source stays in its own repos. This suite repo owns launchers, shared
protocol docs, build/install scripts, and release packaging helpers.

## App Repos

```text
studio          https://github.com/jmars319/vaexcore-studio
pulse           https://github.com/jmars319/vaexcore-pulse
console/VaexCore https://github.com/jmars319/vaexcore-console
```

Clone or update the local app repos:

```bash
./scripts/clone-or-update-apps.sh
```

```powershell
.\scripts\clone-or-update-apps.ps1
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
with release manifest validation. Set `VAEXCORE_SKIP_MAC_PACKAGE=1` to skip the
packaging step.

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

```powershell
.\suite\windows\Build-VaexcoreSuite.ps1
```

On Windows, builds the three Windows desktop artifacts and collects them under
`dist\windows-suite\`. Use `-InstallPrerequisites` on a fresh Windows 11 machine
to install common build prerequisites through `winget`. The script will clone or
update the three app repos before building unless `-SkipAppUpdate` is passed.

The Windows kit also includes double-clickable launchers:

```text
suite\windows\Install-VaexcoreLaunchers.cmd
suite\windows\Start-VaexcoreSuite.cmd
suite\windows\Start-VaexcoreStudio.cmd
suite\windows\Start-VaexcorePulse.cmd
suite\windows\Start-VaexcoreConsole.cmd
```

`Install-VaexcoreLaunchers.cmd` creates Start Menu shortcuts and a desktop
`vaexcore suite` shortcut using the suite logo.

## Suite Contract

`suite/contract.json` is the local operator contract for how the three apps fit
together. It records app IDs, bundle IDs, discovery filenames, health endpoints,
platform install locations, and the Studio-to-Pulse handoff filename.

## Suite Discovery

Packaged apps publish heartbeat files in:

```text
~/Library/Application Support/vaexcore/suite/
%APPDATA%\vaexcore\suite\
```

Studio reads those files for the Suite Status panel and checks whether each app
is installed in the platform app folder, has a running process, and exposes its
local health endpoint.

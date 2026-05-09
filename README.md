# vaexcore suite

vaexcore suite is the orchestration and distribution layer for the vaexcore local creator-tooling ecosystem. It coordinates the independent Studio, Pulse, Console, and Relay repos through shared protocol docs, launchers, release scripts, and suite packaging helpers.

The app source stays in the app repos. This repo owns suite-level integration and distribution behavior.

## Operational Purpose

- Keep the vaexcore desktop apps installable and launchable as a coordinated local suite.
- Track Relay as a service repo without packaging it as a desktop app.
- Define shared suite discovery and integration expectations.
- Provide release, staging, manifest, and launcher scripts.
- Preserve platform-specific packaging knowledge outside individual app codebases where appropriate.

## Design Posture

- App source remains in independent repos.
- Suite scripts make integration and packaging behavior visible.
- Release checks validate manifests and launcher assumptions before distribution.
- Platform-specific behavior is documented in scripts and suite docs.
- The suite repo is coordination infrastructure, not a replacement for app ownership.

## App Repositories

```text
studio           https://github.com/jmars319/vaexcore-studio
pulse            https://github.com/jmars319/vaexcore-pulse
console/VaexCore https://github.com/jmars319/vaexcore-console
```

## Service Repositories

```text
relay            https://github.com/jmars319/vaexcore-relay
```

## Architecture

```text
scripts/         Clone/update, smoke, check, install, release, and manifest helpers
suite/           Suite contract and platform launcher material
suite/windows/   Windows launcher, prerequisite, signing, and packaging scripts
docs/            CI and release-readiness documentation
```

## Current State

- The suite repo tracks the current Studio, Pulse, Console, and Relay repository relationship.
- macOS and Windows distribution scripts are present.
- Suite contract and manifest generation are part of the check/release flow.
- Windows launcher and prerequisite checks have dedicated scripts.
- The repo does not contain the primary application source for the three apps.

## Deployment Posture

vaexcore suite is release-engineering infrastructure. It is useful for local staging and distribution checks, but the maturity of a suite release depends on the current state of each app repo.

## Working Locally

```bash
./scripts/clone-or-update-apps.sh
./scripts/smoke-all.sh
./scripts/check-all.sh
./scripts/dev-all.sh
```

Windows equivalents are available where documented.

## Direction

- Keep suite packaging and app-source ownership clearly separated.
- Strengthen manifest validation and release readiness checks.
- Maintain platform-specific launcher behavior in visible scripts.
- Use the suite repo as the operational coordination layer, not a catch-all monorepo.

## Related Documentation

- [Suite Operations](docs/SUITE_OPERATIONS.md)
- [Bot Completion Runbook](docs/BOT_COMPLETION_RUNBOOK.md)
- [CI](docs/CI.md)
- [Release Readiness](docs/RELEASE_READINESS.md)
- [Windows Suite](suite/windows/README.md)

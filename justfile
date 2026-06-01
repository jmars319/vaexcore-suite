set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    @just --list

verify:
    ./scripts/check-all.sh --manifest-only
    ./scripts/check-maintainability.sh

doctor:
    ./scripts/check-all.sh --manifest-only

maintainability:
    ./scripts/check-maintainability.sh

actions:
    actionlint

security-audit:
    osv-scanner scan source --recursive --allow-no-lockfiles --experimental-exclude node_modules --experimental-exclude .next --experimental-exclude dist --experimental-exclude build --experimental-exclude target --experimental-exclude archive .

security:
    just actions
    just security-audit

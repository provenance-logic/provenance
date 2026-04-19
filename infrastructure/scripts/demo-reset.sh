#!/usr/bin/env bash
# demo-reset.sh
#
# Wraps the seed package reset flows with pre/post health checks.
#
# Usage:
#   bash demo-reset.sh --soft    # clear transactional state; keep base seed
#   bash demo-reset.sh --hard    # truncate all platform schemas; re-seed
#
# The soft flow is the normal between-demos path. Hard is for recovering
# from a corrupted demo run — it tears out seeded data as well.

set -euo pipefail

REPO_ROOT="/opt/provenance"
DEMO_DOMAIN="${DEMO_DOMAIN:-demo.provenancelogic.com}"
MODE="${1:-}"

log()  { echo "[demo-reset $(date '+%H:%M:%S')] $*"; }
fail() { echo "[demo-reset FAIL] $*" >&2; exit 1; }

case "$MODE" in
  --soft|--hard) ;;
  *) fail "Usage: demo-reset.sh --soft | --hard" ;;
esac

# ---------------------------------------------------------------------------
# Pre-check
# ---------------------------------------------------------------------------
log "pre-check: API health"
pre=$(curl -sS -o /dev/null -w "%{http_code}" "https://${DEMO_DOMAIN}/api/health") || true
[ "$pre" = "200" ] || fail "API is not healthy before reset (got $pre) — investigate before mutating state"

# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------
cd "$REPO_ROOT"
if [ "$MODE" = "--soft" ]; then
  log "running soft reset"
  pnpm --filter @provenance/seed run seed:reset:soft \
    || fail "soft reset failed"
else
  log "running HARD reset — all seeded data will be truncated and immediately re-seeded"
  pnpm --filter @provenance/seed run seed:reset:hard \
    || fail "hard reset failed"
fi

# ---------------------------------------------------------------------------
# Post-check
# ---------------------------------------------------------------------------
log "post-check: smoke test"
bash "${REPO_ROOT}/infrastructure/scripts/demo-smoke-test.sh" "https://${DEMO_DOMAIN}" \
  || fail "smoke test failed after reset — do not proceed to demo"

log "reset complete (${MODE#--})"

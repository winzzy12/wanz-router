#!/usr/bin/env bash
# quick-update.sh — pull, rebuild, and restart a local Cartethyia (wanz-router)
# installation in one step.
#
# Usage:
#   bash quick-update.sh              # update to the latest commit on the branch
#   bash quick-update.sh --check      # report whether an update exists, change nothing
#   bash quick-update.sh --no-restart # pull and rebuild, leave the gateway stopped
#   bash quick-update.sh --force      # rebuild and restart even when already current
#
# Optional env overrides:
#   CARTETHYIA_ROOT     install directory (default ~/.local/share/Cartethyia/app)
#   CARTETHYIA_REPO_URL source repository (default winzzy12/wanz-router)
#   CARTETHYIA_BRANCH   branch to update from (default main)
#   CARTETHYIA_HEALTH_TIMEOUT  seconds to wait for readiness (default 60)
#
# What it does:
#   1. Verifies the target is a Cartethyia checkout with a clean working tree.
#   2. Fast-forwards the checkout to the branch tip (never merges or resets).
#   3. Reinstalls dependencies and rebuilds the dashboard + gateway binary.
#   4. Stops the running gateway and starts the freshly built one, then waits
#      for /health to answer.
#
# The gateway is started from the compiled binary (`dist/cartethyia`), which is
# what `scripts/install.sh` runs in local mode. `carte start` is deliberately
# NOT used here: that command boots the gateway from source, which bypasses the
# build-time Elysia patches the compiled binary carries.
set -euo pipefail

HOME_DIR="${HOME:-}"
ROOT="${CARTETHYIA_ROOT:-${HOME_DIR}/.local/share/Cartethyia/app}"
REPO_URL="${CARTETHYIA_REPO_URL:-https://github.com/winzzy12/wanz-router.git}"
BRANCH="${CARTETHYIA_BRANCH:-main}"
HEALTH_TIMEOUT="${CARTETHYIA_HEALTH_TIMEOUT:-60}"

MODE="update"
for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --no-restart) MODE="no-restart" ;;
    --force) MODE="force" ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg (try --help)" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# --- Locate and validate the installation. ---
ROOT=$(CDPATH= cd -- "$ROOT" 2>/dev/null && pwd) || die "Cannot resolve install root: $ROOT"
[ -d "$ROOT/.git" ] || die "$ROOT is not a git checkout. Run quick-setup.sh first."
[ -f "$ROOT/package.json" ] || die "$ROOT has no package.json — not a Cartethyia install."
grep -q '"name"[[:space:]]*:[[:space:]]*"cartethyia"' "$ROOT/package.json" \
  || die "$ROOT does not look like a Cartethyia install (package.json name mismatch)."

# --- Bun must be available for the build. ---
if ! command -v bun >/dev/null 2>&1; then
  if [ -n "$HOME_DIR" ] && [ -x "$HOME_DIR/.bun/bin/bun" ]; then
    export PATH="$HOME_DIR/.bun/bin:$PATH"
  else
    die "bun was not found. Install it first (https://bun.sh) or re-run quick-setup.sh."
  fi
fi

cd "$ROOT"

# --- Refuse to build over uncommitted edits to tracked files. ---
# Untracked files are left alone: a build writes into `dist/` and `data/`, which
# are ignored, and refusing on those would make the script unusable after any
# run. A fast-forward that would overwrite an untracked file still fails loudly
# at the merge step.
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  die "Tracked files have uncommitted changes in $ROOT. Commit or stash them first."
fi

CURRENT=$(git rev-parse --short HEAD)
log "Checking $BRANCH at $REPO_URL (current: $CURRENT)"

# Fetched from an explicit URL rather than `origin`. A checkout keeps whatever
# remote the clone came from, and an install forked from upstream can have an
# `origin` that points somewhere else entirely — comparing against that remote
# would offer to fast-forward into unrelated history. A URL is unambiguous.
git fetch --quiet "$REPO_URL" "$BRANCH" || die "Could not fetch $BRANCH from $REPO_URL. Check the network and CARTETHYIA_REPO_URL."
TARGET_SHA=$(git rev-parse FETCH_HEAD)
TARGET=$(git rev-parse --short "$TARGET_SHA")

# The fetched tip must descend from this checkout's HEAD for an update to mean
# anything. Otherwise the install tracks a different repository or branch and a
# fast-forward would either fail confusingly or graft an unrelated history.
if [ "$CURRENT" != "$TARGET" ] && ! git merge-base --is-ancestor HEAD "$TARGET_SHA"; then
  die "This checkout does not descend from $BRANCH at $REPO_URL — it tracks a different repository or branch. Nothing was changed."
fi

if [ "$CURRENT" = "$TARGET" ]; then
  if [ "$MODE" != "force" ]; then
    log "Already up to date ($CURRENT). Nothing to do."
    echo "  Use --force to rebuild and restart anyway."
    exit 0
  fi
  log "Already current ($CURRENT) — rebuilding anyway (--force)"
else
  # Counted before the fast-forward so the report can state what moved.
  AHEAD=$(git rev-list --count "HEAD..$TARGET_SHA")
  log "$AHEAD new commit(s): $CURRENT → $TARGET"
  if [ "$MODE" = "check" ]; then
    # Bounded: a long-dormant install can be hundreds of commits behind, and a
    # wall of log output buries the two numbers that matter.
    git --no-pager log --oneline --no-decorate --max-count=15 "HEAD..$TARGET_SHA" | sed 's/^/    /'
    if [ "$AHEAD" -gt 15 ]; then echo "    … and $((AHEAD - 15)) more"; fi
    exit 0
  fi
fi

if [ "$MODE" = "check" ]; then
  exit 0
fi

# --- Fast-forward only. Never merge, never reset. ---
git merge --ff-only --quiet "$TARGET_SHA" || die "Fast-forward failed. Resolve the checkout by hand, then re-run."
NEW=$(git rev-parse --short HEAD)

# --- Dependencies, then the build (dashboard + AOT + compiled binary). ---
log "Installing dependencies"
bun install --linker isolated --frozen-lockfile

log "Building (dashboard, AOT, gateway binary)"
bun run build

# --- Restart on the new binary. ---
PORT_VALUE=$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '"' || true)
PORT_VALUE="${PORT_VALUE:-12800}"

# The launcher owns the drain-token path, so `carte stop` is the correct way to
# stop this install's gateway (it drains in-flight requests instead of killing).
if [ -x "$ROOT/carte" ]; then
  log "Stopping the gateway"
  "$ROOT/carte" stop || warn "gateway stop reported an error (continuing)"
  sleep 1
else
  warn "No carte launcher found; skipping the stop step."
fi

if [ "$MODE" = "no-restart" ]; then
  log "Done — the gateway is stopped. Start it with: $ROOT/carte menu"
  echo "  Updated: $CURRENT → $NEW (not started, --no-restart)"
  exit 0
fi

log "Starting the gateway"
# Started through the installer's own path (startGateway → detached binary), so
# the drain token, instance lock, and log file stay consistent with an install.
HELPER="$ROOT/.quick-update-boot.ts"
cleanup() { rm -f "$HELPER"; }
trap cleanup EXIT

cat > "$HELPER" <<'TS'
import { readFile } from "node:fs/promises";
const ROOT = process.env.QUICK_UPDATE_ROOT!;
try {
  const envText = await readFile(`${ROOT}/.env`, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {
  // No .env means nothing to load; the gateway reports its own missing config.
}
process.env.CARTETHYIA_CONFIG_DIR = ROOT;
process.env.CARTETHYIA_PACKAGE_ROOT = ROOT;
process.env.CARTETHYIA_GATEWAY_BINARY = `${ROOT}/dist/cartethyia`;
const { ensureDrainToken } = await import(`${ROOT}/scripts/cli/instance.ts`);
const { startGateway } = await import(`${ROOT}/scripts/cli/gateway.ts`);
const { resolvePort } = await import(`${ROOT}/src/config/runtime.ts`);
const token = ensureDrainToken();
const port = resolvePort();
const child = await startGateway(port, token, { detached: true });
console.log(`GATEWAY_STARTED pid=${child.pid} port=${port}`);
TS

if ! QUICK_UPDATE_ROOT="$ROOT" bun run "$HELPER"; then
  warn "The gateway did not report readiness. Inspect $ROOT/gateway.log"
  die "Update applied ($NEW), but the restart failed."
fi

# --- Confirm over HTTP rather than trusting the spawn. ---
READY=0
for _ in $(seq 1 "$HEALTH_TIMEOUT"); do
  if curl -fsS -m 2 "http://127.0.0.1:${PORT_VALUE}/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
[ "$READY" = "1" ] || { warn "Health check did not answer on port $PORT_VALUE."; die "Update applied ($NEW), but the gateway is not ready."; }

log "Done."
echo "  Updated   : $CURRENT → $NEW"
echo "  Console   : http://localhost:${PORT_VALUE}/console"
echo "  Manage    : $ROOT/carte menu"
echo "  Uninstall : bash $ROOT/uninstall.sh"

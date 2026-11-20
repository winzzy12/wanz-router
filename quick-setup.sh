#!/usr/bin/env bash
# quick-setup.sh — one-command Cartethyia setup (local, Lite/SQLite mode).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/winzzy12/wanz-router/main/quick-setup.sh | bash
#   # or, from inside this checkout:
#   bash quick-setup.sh
#
# Optional env overrides:
#   CARTETHYIA_REPO_URL   source repository URL
#   CARTETHYIA_BRANCH     branch to clone (default main)
#   CARTETHYIA_ROOT       install directory (default ~/.local/share/Cartethyia/app)
#
# Extra arguments are forwarded to scripts/install.sh (e.g. --port 9000,
# --skip-deps, --no-start).
set -euo pipefail

REPO_URL="${CARTETHYIA_REPO_URL:-https://github.com/winzzy12/wanz-router.git}"
BRANCH="${CARTETHYIA_BRANCH:-main}"
ROOT="${CARTETHYIA_ROOT:-$HOME/.local/share/Cartethyia/app}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

# 1. Prerequisites — fail fast with a clear message.
for tool in git curl python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Missing required tool: $tool" >&2
    echo "Install it first, e.g.: sudo apt-get install -y git curl python3" >&2
    exit 1
  fi
done

# 2. Bun — Cartethyia's required runtime.
if ! command -v bun >/dev/null 2>&1; then
  log "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi
log "Bun $(bun --version)"

# 3. Obtain the checkout.
if [ -f "$ROOT/scripts/install.sh" ]; then
  log "Using existing checkout: $ROOT"
else
  log "Cloning $REPO_URL into $ROOT"
  mkdir -p "$ROOT"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$ROOT"
fi

# 4. Run the official installer in local Lite mode.
cd "$ROOT"
log "Running installer (local, Lite)"
bash scripts/install.sh --local --lite --root "$ROOT" "$@"

# 5. Report.
log "Done."
echo "  Console   : http://localhost:12800/console"
echo "  Manage    : $ROOT/carte menu"
echo "  Stop      : $ROOT/carte stop"
echo "  Uninstall : bash $ROOT/uninstall.sh"

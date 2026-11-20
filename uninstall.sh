#!/usr/bin/env bash
# uninstall.sh — stop and remove a local Cartethyia (wanz-router) install.
#
# Usage:
#   bash uninstall.sh              # interactive (asks for confirmation)
#   bash uninstall.sh --yes        # non-interactive
#   bash uninstall.sh --dry-run    # show what would happen without changing anything
#
# Optional env overrides:
#   CARTETHYIA_ROOT   install directory (default ~/.local/share/Cartethyia/app)
#
# What it does:
#   1. Verifies the target is actually a Cartethyia install (guards against
#      deleting the wrong directory).
#   2. Stops the running gateway via `./carte stop` (the proper drain path —
#      never pkill / a port-wide kill).
#   3. Removes the entire install directory, including the checkout, .env,
#      data (SQLite), and built artifacts.
#
# Bun itself is NOT removed (it may be shared by other tools). To remove Bun
# too, delete $HOME/.bun manually.
set -euo pipefail

HOME_DIR="${HOME:-}"
ROOT="${CARTETHYIA_ROOT:-${HOME_DIR}/.local/share/Cartethyia/app}"
CONFIRM=0
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    -y|--yes) CONFIRM=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $arg (try --help)" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

# Resolve to an absolute path.
ROOT=$(CDPATH= cd -- "$ROOT" 2>/dev/null && pwd) || die "Cannot resolve install root: $ROOT"

# --- Safety: never delete the filesystem root or the user's home. ---
case "$ROOT" in
  /) die "Refusing to remove the filesystem root." ;;
esac
if [ -n "$HOME_DIR" ] && [ "$ROOT" = "$HOME_DIR" ]; then
  die "Refusing to remove your home directory. Set CARTETHYIA_ROOT to the install directory."
fi

# --- Safety: only act on a directory that looks like a Cartethyia install. ---
is_cartethyia_install() {
  if [ -f "$ROOT/carte" ] && [ -f "$ROOT/.env" ]; then return 0; fi
  if [ -f "$ROOT/package.json" ] && grep -q '"name"[[:space:]]*:[[:space:]]*"cartethyia"' "$ROOT/package.json" 2>/dev/null; then return 0; fi
  return 1
}

if [ ! -d "$ROOT" ]; then
  die "Install directory does not exist: $ROOT"
fi
if ! is_cartethyia_install; then
  die "$ROOT does not look like a Cartethyia install (missing carte/.env or cartethyia package.json). Refusing to delete it."
fi

if [ "$DRY_RUN" = "1" ]; then
  log "DRY RUN — nothing will be changed."
  echo "  Would stop the gateway (if running): $ROOT/carte stop"
  echo "  Would delete: $ROOT"
  exit 0
fi

# --- Stop the gateway (best effort; never a blanket kill). ---
if [ -f "$ROOT/carte" ]; then
  if [ -n "$HOME_DIR" ] && [ -d "$HOME_DIR/.bun/bin" ]; then export PATH="$HOME_DIR/.bun/bin:$PATH"; fi
  if command -v bun >/dev/null 2>&1; then
    ( cd "$ROOT" && ./carte stop ) || warn "gateway stop reported an error (continuing)"
    # Disable autostart if it was enabled.
    ( cd "$ROOT" && ./carte autostart off ) >/dev/null 2>&1 || true
  else
    warn "bun was not found, so the gateway could not be stopped cleanly."
    warn "If it is still running, stop it manually (reinstall bun, then run: $ROOT/carte stop) before deleting."
  fi
else
  warn "No carte launcher found; skipping gateway stop."
fi

# --- Confirm and remove. ---
if [ "$CONFIRM" != "1" ]; then
  printf '\033[1;33mRemove the entire install at:\033[0m\n  %s\n' "$ROOT" >&2
  read -r -p "This deletes the checkout, .env, and data. Continue? [y/N] " ans
  case "$ans" in
    y|Y) ;;
    *) echo "Cancelled." >&2; exit 1 ;;
  esac
fi

log "Removing $ROOT"
cd /
rm -rf "$ROOT"

log "Done."
echo "  Cartethyia (wanz-router) has been uninstalled."
echo "  Bun was left in place (${HOME_DIR:-~}/.bun). Remove it manually if unused."

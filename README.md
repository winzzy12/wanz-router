# wanz-router

**A self-hosted multi-provider AI gateway — a deployment-focused distribution of [Cartethyia](https://github.com/risunCodex/Cartethyia).**

One stable, [OI]- and Anthropic-compatible endpoint. Behind it, the gateway routes
across provider ecosystems, translating requests and responses in real time with
account selection, health-aware failover, quota and cooldown enforcement, usage
accounting, telemetry, and optional proxy pools.

---

## What this repository is

`wanz-router` is a ready-to-deploy distribution of Cartethyia. It keeps the full
upstream engine (Bun + TypeScript + Elysia, embedded SQLite or external PostgreSQL,
optional Redis) and adds:

- **`quick-setup.sh`** — one-command local install (Lite/SQLite mode).
- Sensible defaults tuned for a single-host, personal deployment.

Everything else stays faithful to upstream. For the complete feature reference,
architecture, and configuration guide, see the upstream documentation in
[`documentation/`](documentation/).

> **License:** [GNU GPL v3.0 only](LICENSE). Upstream: [risunCodex/Cartethyia](https://github.com/risunCodex/Cartethyia).
> If you ship a build or a fork, ship the source with it, under the same license.

---

## Requirements

- Linux or macOS
- `git`, `curl`, `python3`
- **Bun 1.4.0 or newer** (the installer fetches it automatically when missing)

No Node.js, no Docker, no PostgreSQL required for the default (Lite) setup.

---

## Quick setup

One command from any fresh Linux/macOS host:

```bash
curl -fsSL https://raw.githubusercontent.com/winzzy12/wanz-router/main/quick-setup.sh | bash
```

## Update
```bash
curl -fsSL https://raw.githubusercontent.com/winzzy12/wanz-router/main/quick-update.sh | bash
```

## Uninstall
```bash
wget https://raw.githubusercontent.com/winzzy12/wanz-router/main/uninstall.sh && chmod +x uninstall.sh && ./uninstall.sh
```


Or, from a local checkout:

```bash
git clone https://github.com/winzzy12/wanz-router.git
cd wanz-router
bash quick-setup.sh
```

The script checks prerequisites, installs Bun if needed, clones the checkout,
runs the official installer in **local Lite** mode, and prints the console URL.

Optional overrides (passed as environment variables or extra arguments):

```bash
# Custom install directory, port, and skip system dependency install
CARTETHYIA_ROOT=/opt/wanz-router bash quick-setup.sh --port 9000 --skip-deps
```

---

## After setup

Open the console and complete the first-boot wizard:

```
http://localhost:12800/console
```

Configure provider accounts, issue an API key, and point any compatible client
(OpenCode, Kilo, Droid, Cline, Codex, ZCode, …) at the gateway's `[OI]` /
Anthropic-compatible endpoints (`/v1/chat/completions`, `/v1/messages`,
`/v1/responses`, …).

### Everyday commands

From the install root (default `~/.local/share/Cartethyia/app`, or wherever
`CARTETHYIA_ROOT` pointed):

```bash
./carte menu      # attach to the running gateway (console, reset password, backup, update, exit)
./carte doctor    # configuration + readiness check
./carte stop      # stop this installation's gateway
```

---

## Update

Pull the latest commit, rebuild, and restart in one step:

```bash
bash quick-update.sh              # update to the latest commit, then restart
bash quick-update.sh --check      # show what is new, change nothing
bash quick-update.sh --no-restart # pull and rebuild, leave the gateway stopped
bash quick-update.sh --force      # rebuild and restart even when already current
```

What it does, in order:

1. Refuses to touch a checkout with uncommitted changes to tracked files.
2. Fetches the configured branch and **fast-forwards only** — never a merge and
   never a reset, so local commits are never silently discarded.
3. Reinstalls dependencies and rebuilds the dashboard, the AOT bundle, and the
   compiled gateway binary.
4. Stops the gateway through `./carte stop` (a drain, not a kill), starts the
   freshly built binary, and waits for `/health` to answer before reporting
   success.

- Point it at a non-default install with `CARTETHYIA_ROOT=/path/to/app bash quick-update.sh`.
- It also refuses a checkout that does not descend from the configured branch,
  which is what catches a fork whose `origin` points at a different repository.
- Override the source with `CARTETHYIA_REPO_URL=…` and the branch with
  `CARTETHYIA_BRANCH=…`.

---

## Uninstall

Remove a local install cleanly with the bundled script:

```bash
bash uninstall.sh            # interactive (asks for confirmation)
bash uninstall.sh --yes      # non-interactive
bash uninstall.sh --dry-run  # preview only, change nothing
```

The script stops the running gateway through the proper drain path
(`./carte stop` — never a blanket `pkill`), then deletes the entire install
directory: checkout, `.env`, SQLite data, and built artifacts.

- Point it at a non-default install with `CARTETHYIA_ROOT=/path/to/app bash uninstall.sh`.
- It refuses to delete the filesystem root, your home directory, or anything
  that does not look like a Cartethyia install.
- **Bun is left in place** (`~/.bun`) since other tools may share it; delete it
  manually if you no longer need it.

> **Tip:** export a backup first (`./carte menu` → Backup) if you might want to
> restore this install later. Uninstalling deletes all local data.

---

## Database modes

| Mode | Pick it when |
| --- | --- |
| **Lite** (default) | One person, one machine, or you just want it running |
| **Full** | Several people, a VPS, or SQLite becomes the bottleneck |

`quick-setup.sh` installs Lite. To run Full (external PostgreSQL) or deploy to a
VPS/Docker, follow the upstream guide at
[`documentation/installation.md`](documentation/installation.md).

---

## Security

Cartethyia stores provider credentials and API keys on the host. Restrict console
access, keep `.env` private (it is written with mode `0600`), and store backups
somewhere you control. Never commit `.env` or the generated runtime scratch files
(`instance.json`, `runtime.json`, `carte`) — they are already git-ignored.

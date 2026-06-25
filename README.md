# beszel-cli

> Read-only [Beszel](https://beszel.dev) monitoring from your terminal or AI agent scripts — clean JSON for scripting, colored tables for humans.

[![npm version](https://img.shields.io/npm/v/beszel-cli.svg)](https://www.npmjs.com/package/beszel-cli)
[![license](https://img.shields.io/npm/l/beszel-cli.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/beszel-cli.svg)](https://nodejs.org)

> [!NOTE]
> **Unofficial.** This is a community CLI and is **not** affiliated with or endorsed by the Beszel project. It talks to a Beszel hub through its public API.

All commands are **read-only** — the CLI never mutates your hub. Output is machine-friendly JSON by default in pipelines, or human-friendly TTY tables with color in a terminal.

---

## Features

- **Six read-only commands** covering systems, containers, disks, temperatures, and fleet health.
- **Dual output**: clean JSON for scripts/agents, colored tables for humans — auto-detected from the TTY.
- **Agent-ready**: stable JSON shapes, a structured error envelope, and meaningful exit codes.
- **Zero config files**: configured entirely through environment variables.
- **Token caching**: authenticates once and reuses the token across calls.

## Installation

Requires **Node.js >= 18**.

```sh
# Global install — exposes the `beszel` command
npm install -g beszel-cli
```

<details>
<summary>Other package managers</summary>

```sh
pnpm add -g beszel-cli
yarn dlx beszel-cli --help     # one-off run without installing (Yarn Berry)
```

</details>

Or run it once without installing:

```sh
npx beszel-cli --help
```

## Quick Start

```sh
# 1. Point the CLI at your hub
export BESZEL_URL=https://beszel.example.com
export BESZEL_EMAIL=admin@example.com
export BESZEL_PASSWORD=secret

# 2. Run a health check — exit 0 = ok, exit 1 = CRITICAL
beszel health

# 3. List your fleet (human table)
beszel systems

# Add --json anywhere for machine-readable output
beszel systems --json
```

## Usage

```text
beszel [global flags] <command> [options]
```

### Getting help

The CLI is self-documenting — every command and flag is discoverable from the terminal:

| Command | What it shows |
|---------|---------------|
| `beszel --help`, `beszel -h` | Top-level help: global flags and the list of commands |
| `beszel help <command>` | Help for a specific command |
| `beszel <command> --help`, `beszel <command> -h` | Same help, invoked from the command itself |
| `beszel --version`, `beszel -V` | Installed version |

```sh
beszel --help            # overview of all commands
beszel help system       # detail for the `system` command
beszel health -h         # flags and thresholds for `health`
beszel --version         # e.g. 0.1.0
```

### Global flags

Available on every command:

| Flag | Description |
|------|-------------|
| `--json` | Force JSON output. Also active automatically when stdout is not a TTY or `CI=true`. |
| `--no-color` | Suppress ANSI colors in TTY output. |
| `--no-cache` | Disable the token cache; always re-authenticate. |

## Configuration

Configuration is read from environment variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `BESZEL_URL` | Yes | Base URL of your Beszel hub (e.g. `https://beszel.example.com`) |
| `BESZEL_EMAIL` | Yes | Account email used to authenticate |
| `BESZEL_PASSWORD` | Yes | Account password |
| `BESZEL_AUTH_COLLECTION` | No | Auth collection name if not the default `users` (e.g. `admins`) |

The auth token is cached at `~/.cache/beszel-cli/token.json` (mode `600`) and reused across calls. Pass `--no-cache` to bypass it (e.g. in CI).

## Commands

| Command | Purpose |
|---------|---------|
| [`beszel systems`](#beszel-systems) | List all fleet systems with live snapshot metrics |
| [`beszel system <name>`](#beszel-system-name) | Detail for one system (add `--since` for history) |
| [`beszel containers`](#beszel-containers) | List containers across the fleet |
| [`beszel disks`](#beszel-disks) | List SMART disks and RAID arrays |
| [`beszel temps`](#beszel-temps) | Temperature summary per system |
| [`beszel health`](#beszel-health) | Fleet health evaluation with structured issues |

## Command reference

Only command-specific options are listed below — the [global flags](#global-flags)
(`--json`, `--no-color`, `--no-cache`) apply to all of them. For the complete JSON
output shapes and field-stability contract, see [`SKILL.md`](./SKILL.md).

### `beszel systems`

List all fleet systems with live snapshot metrics (CPU, memory, disk, uptime, status).

```text
beszel systems [options]
```

| Option | Description |
|--------|-------------|
| `--status <value>` | Filter by system status: `up`, `down`, `paused`, `pending` |

```sh
beszel systems                       # human table
beszel systems --json                # machine-readable
beszel systems --status up --json    # only running systems
beszel systems --json | jq '.systems[] | {name, cpu, memPct}'
```

### `beszel system <name>`

Detail for one system, resolved by **name** (case-insensitive) or **id**. Add `--since` to include a historical time-series.

```text
beszel system <name> [options]
```

| Option | Description |
|--------|-------------|
| `--since <duration>` | Historical window: `<number><unit>`, unit = `m`/`h`/`d` (e.g. `30m`, `12h`, `7d`). Max `30d` (clamped with a stderr warning). |

```sh
beszel system "Home Lab"                     # human view
beszel system "Zima Blade" --json            # snapshot JSON
beszel system "Zima Blade" --since 24h --json   # snapshot + 24h history
beszel system sys001homela --json            # lookup by id
beszel system "Home Lab" --json | jq '.system.cpu'
```

> If multiple systems share the same name, the CLI exits `3` (`AMBIGUOUS_SYSTEM`) and lists the matching ids in the error hint — disambiguate by passing the id.

### `beszel containers`

List containers across the fleet, sortable and filterable.

```text
beszel containers [options]
```

| Option | Description |
|--------|-------------|
| `--top <n>` | Limit results to the top N items |
| `--sort <field>` | Sort field: `cpu` (default) or `memory` |
| `--system <name>` | Filter to one system (by name or id) |
| `--since <duration>` | Historical window (e.g. `30m`, `12h`, `7d`) |

```sh
beszel containers                                  # human table
beszel containers --json                           # all containers
beszel containers --top 10 --sort memory --json    # top 10 by memory
beszel containers --system "Home Lab" --json       # one system only
beszel containers --top 5 --sort cpu --json | jq '.containers[].name'
```

### `beszel disks`

List SMART disks and RAID arrays. RAID entries include `arrayState` and `syncAction`.

```text
beszel disks [options]
```

| Option | Description |
|--------|-------------|
| `--system <name>` | Filter to one system (by name or id) |
| `--failing` | Show only failing devices: disks where `state != PASSED`, or RAID where `arrayState != clean` or `syncAction != idle` |

```sh
beszel disks                            # human table
beszel disks --json                     # all devices
beszel disks --failing --json           # only failing devices
beszel disks --system "Home Lab" --json # one system only
beszel disks --failing --json | jq '.devices[] | select(.kind == "raid")'
```

### `beszel temps`

Temperature summary per system. `displayTempC` comes from the live snapshot; `sensors` from the latest 1-minute stats bucket.

```text
beszel temps [options]
```

| Option | Description |
|--------|-------------|
| `--disks` | Merge disk (SMART) temperatures into the `sensors` map as `<device>_temp` keys |

```sh
beszel temps                  # human table
beszel temps --json           # all temps
beszel temps --disks --json   # include disk sensors
beszel temps --disks --json | jq '[.systems[].sensors | to_entries[] | select(.value > 50)]'
```

### `beszel health`

Evaluate fleet health across status, SMART state, RAID arrays, disk usage, and temperatures. Emits a structured `issues` list and a health-based exit code.

```text
beszel health [options]
```

| Option | Env var | Default | Description |
|--------|---------|---------|-------------|
| `--disk-warn <pct>` | `BESZEL_DISK_WARN` | `90` | Disk usage warning threshold % |
| `--disk-crit <pct>` | `BESZEL_DISK_CRIT` | `95` | Disk usage critical threshold % |
| `--temp-warn <c>` | `BESZEL_TEMP_WARN` | `80` | System temperature warning threshold °C |
| `--temp-crit <c>` | `BESZEL_TEMP_CRIT` | `90` | System temperature critical threshold °C |
| `--disk-temp-warn <c>` | `BESZEL_DISK_TEMP_WARN` | `55` | Disk temperature warning threshold °C |
| `--disk-temp-crit <c>` | `BESZEL_DISK_TEMP_CRIT` | `65` | Disk temperature critical threshold °C |
| `--strict` | `BESZEL_STRICT` | — | Promote all warnings to critical: exit `1` when any issue exists |

```sh
beszel health                                      # human report
beszel health --json                               # structured issues
beszel health --strict --json                      # any issue → exit 1
beszel health --disk-warn 80 --disk-crit 90 --json # custom thresholds
beszel health --json | jq -e '.healthy'            # exit 1 if not healthy
```

> **Exit code nuance:** `healthy: false` with exit `0` means a warning-only fleet (CI still passes). Agents should branch on the `healthy` field, not just the exit code. See [Exit Codes](#exit-codes).

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (healthy fleet, or warning-only without `--strict`) |
| 1 | Config/validation error, CRITICAL health issue, or `--strict` with any warning |
| 2 | Authentication failed (bad credentials or expired session) |
| 3 | System not found or ambiguous (multiple name matches) |
| 4 | Network error (unreachable hub, timeout, 5xx, non-JSON response) |

## JSON output & errors

In JSON mode, successful commands print one object to stdout (shapes per command in [`SKILL.md`](./SKILL.md)). Any non-zero exit prints a single error envelope:

```json
{
  "error": {
    "code": "AUTH_FAILED",
    "message": "Authentication failed",
    "hint": "Check BESZEL_EMAIL / BESZEL_PASSWORD"
  }
}
```

Stderr carries human-readable diagnostics (warnings, clamp notices) and is **not** valid JSON.

## For AI Agents

Building an agent on top of this CLI? The companion **[`SKILL.md`](./SKILL.md)** is a
complete, machine-generated reference designed to drop straight into an agent's context:

- Full JSON output shapes per command — `STABLE` vs `optional` fields
- The error envelope schema and every `ErrorCode`
- Flag and environment-variable reference
- Worked `jq` recipes for common agent tasks

A typical agent flow — gate on health, then read a metric:

```sh
beszel health --json | jq -e '.healthy'   # exits 1 if the fleet is unhealthy
beszel system "Zima Blade" --json | jq '.system.cpu'
```

## Compatibility

Tested against the Beszel agent range `>=0.18 <0.19`. Out-of-range versions emit a stderr warning but never error.

## Development

```sh
git clone https://github.com/Anb98/beszel-cli.git
cd beszel-cli
corepack enable      # this repo uses Yarn Berry (yarn@4)
yarn install
yarn build           # compile TypeScript → dist/cli.js
yarn dev -- --help   # run from source without building
```

Common tasks:

| Script | What it does |
|--------|--------------|
| `yarn build` | Compile TypeScript → `dist/cli.js` |
| `yarn typecheck` | `tsc --noEmit` |
| `yarn lint` | `eslint src` |
| `yarn test` | `vitest run` |
| `yarn gen:skill` | Regenerate `SKILL.md` from the command registry |
| `yarn check:skill` | CI guard: fail if `SKILL.md` is stale |

Full CI pipeline:

```sh
yarn build && yarn typecheck && yarn lint && yarn test && yarn check:skill
```

## Contributing

Issues and pull requests are welcome at
[github.com/Anb98/beszel-cli](https://github.com/Anb98/beszel-cli/issues).
Please run the full CI pipeline above before opening a PR.

## License

[MIT](./LICENSE) © Anb98

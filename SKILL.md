---
name: beszel
description: "Trigger: Beszel monitoring, fleet metrics, system/container/disk/temp stats, hub health. Query a Beszel hub read-only via the `beszel` CLI; returns JSON or human tables."
license: MIT
---

# beszel — Agent Skill Reference

> Machine-generated from the command-contract registry. Do NOT hand-edit.
> Beszel version range: `>=0.18 <0.19` (out-of-range → stderr warning, never an error).

## When to use

Use this skill to **read** monitoring data from a Beszel hub: fleet inventory, live
system metrics, container/disk/temperature stats, historical series, and fleet health
checks. Every command is **read-only** and never mutates the hub. Prefer `--json` for
any programmatic decision — it is always safe and the output shapes below are stable.

## Contents

- [Quick Start](#quick-start)
- [Command Reference](#command-reference)
- [Command Detail](#command-detail)
- [Exit Codes](#exit-codes)
- [Error Envelope](#error-envelope)
- [Environment Variables](#environment-variables)
- [Field Stability Contract](#field-stability-contract)
- [`--since` Duration Format](#--since-duration-format)
- [System Resolution](#system-resolution-beszel-system)
- [Worked Agent Examples](#worked-agent-examples)

---

## Quick Start

```sh
# Set required environment variables once per session
export BESZEL_URL=https://beszel.example.com
export BESZEL_EMAIL=admin@example.com
export BESZEL_PASSWORD=secret

# Verify connectivity
beszel health --json

# List all systems
beszel systems --json

# Discover commands and flags
beszel --help
beszel <command> --help    # e.g. beszel health --help
```

---

## Command Reference

| Command             | Purpose                                                                                                                                                                                                   | JSON output shape                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `beszel systems`    | List all fleet systems with live snapshot metrics.                                                                                                                                                        | { "systems": SystemItem[] }                                                                                                      |
| `beszel system`     | Show detail for one system resolved by name (case-insensitive) or id. Optionally include historical stats with --since.                                                                                   | { "system": SystemDetail, "details": SystemDetailsInfo | null } | with --since: adds "history": HistoricalEnvelope<StatsPoint[]> |
| `beszel containers` | List containers across the fleet, sortable by cpu or memory, filterable by system.                                                                                                                        | { "containers": ContainerInfo[] }                                                                                                |
| `beszel disks`      | List SMART disks and RAID arrays across the fleet. RAID entries include arrayState and syncAction.                                                                                                        | { "devices": Array<DiskInfo | RaidInfo> }                                                                                        |
| `beszel temps`      | Show temperatures for all fleet systems. displayTempC is from the live snapshot; sensors is from the latest 1-minute stats bucket.                                                                        | { "systems": TempInfo[] }                                                                                                        |
| `beszel health`     | Evaluate fleet health across status, SMART state, RAID arrays, disk usage, and temperatures. Emits structured issues list. Exit 0 = healthy/warning-only; exit 1 = CRITICAL (or any issue with --strict). | { "healthy": boolean, "issues": HealthIssue[], "checked": number }                                                               |

---

## Command Detail

### `beszel systems`

**List all fleet systems with live snapshot metrics.**

Usage: `beszel systems [options]`

**Output shape:** `{ "systems": SystemItem[] }`

**Fields:**

| Field                      | Type                     | Stability | Description                                  |
| -------------------------- | ------------------------ | --------- | -------------------------------------------- |
| `systems[].id`             | `string`                 | STABLE    | PocketBase record id                         |
| `systems[].name`           | `string`                 | STABLE    | System display name                          |
| `systems[].host`           | `string | null`          | STABLE    | Host identifier                              |
| `systems[].status`         | `string`                 | STABLE    | up | down | paused | pending                 |
| `systems[].cpu`            | `number | null`          | STABLE    | CPU %                                        |
| `systems[].memPct`         | `number | null`          | STABLE    | Memory %                                     |
| `systems[].diskPct`        | `number | null`          | STABLE    | Root disk %                                  |
| `systems[].uptimeS`        | `number | null`          | STABLE    | Uptime in seconds                            |
| `systems[].agentVersion`   | `string | null`          | STABLE    | Beszel agent version                         |
| `systems[].tempC`          | `number`                 | optional  | Display temperature °C (info.dt)             |
| `systems[].containerCount` | `number`                 | optional  | Container count (info.ct)                    |
| `systems[].loadAvg`        | `number[]`               | optional  | Load avg [1m, 5m, 15m] (info.la)             |
| `systems[].extraFs`        | `Record<string, number>` | optional  | Extra/RAID filesystem usage % map (info.efs) |

**Flags:**

- `--status <value>`: Filter by system status (e.g. up, down, paused).
- `--json`: Force JSON output. Also active when stdout is not a TTY or CI=true.
- `--no-color`: Suppress ANSI colors in TTY output.
- `--no-cache`: Disable token cache; always re-authenticate.

**Examples:**

```sh
# List all systems as JSON
beszel systems --json

# Filter to running systems
beszel systems --status up --json

# Human TTY table
beszel systems
```

---

### `beszel system`

**Show detail for one system resolved by name (case-insensitive) or id. Optionally include historical stats with --since.**

Usage: `beszel system <name> [options]`

**Output shape:** `{ "system": SystemDetail, "details": SystemDetailsInfo | null } | with --since: adds "history": HistoricalEnvelope<StatsPoint[]>`

**Fields:**

| Field                   | Type                               | Stability | Description                            |
| ----------------------- | ---------------------------------- | --------- | -------------------------------------- |
| `system.id`             | `string`                           | STABLE    | PocketBase record id                   |
| `system.name`           | `string`                           | STABLE    | System display name                    |
| `system.host`           | `string | null`                    | STABLE    | Host identifier                        |
| `system.status`         | `string`                           | STABLE    | up | down | paused | pending           |
| `system.cpu`            | `number | null`                    | STABLE    | CPU %                                  |
| `system.memPct`         | `number | null`                    | STABLE    | Memory %                               |
| `system.diskPct`        | `number | null`                    | STABLE    | Root disk %                            |
| `system.uptimeS`        | `number | null`                    | STABLE    | Uptime in seconds                      |
| `system.agentVersion`   | `string | null`                    | STABLE    | Beszel agent version                   |
| `details`               | `SystemDetailsInfo | null`         | STABLE    | Hardware/OS details (null when absent) |
| `details.hostname`      | `string | null`                    | STABLE    | Hostname                               |
| `details.os`            | `string | null`                    | STABLE    | OS name (e.g. Alpine Linux)            |
| `details.kernel`        | `string | null`                    | STABLE    | Kernel version                         |
| `details.cpuModel`      | `string | null`                    | STABLE    | CPU model string                       |
| `details.arch`          | `string | null`                    | STABLE    | CPU architecture                       |
| `details.cores`         | `number | null`                    | STABLE    | Physical cores                         |
| `details.threads`       | `number | null`                    | STABLE    | Hardware threads                       |
| `details.memoryBytes`   | `number | null`                    | STABLE    | Total memory bytes                     |
| `history.interval`      | `string`                           | STABLE    | Bucket: 1m | 10m | 20m | 120m | 480m   |
| `history.from`          | `string`                           | STABLE    | ISO 8601 window start                  |
| `history.to`            | `string`                           | STABLE    | ISO 8601 window end (now)              |
| `history.points`        | `StatsPoint[]`                     | STABLE    | Ordered time-series data points        |
| `system.tempC`          | `number`                           | optional  | Display temperature °C                 |
| `system.containerCount` | `number`                           | optional  | Container count                        |
| `system.loadAvg`        | `number[]`                         | optional  | Load avg [1m, 5m, 15m]                 |
| `system.extraFs`        | `Record<string, number>`           | optional  | Extra/RAID filesystem usage % map      |
| `details.podman`        | `boolean`                          | optional  | true when container runtime is Podman  |
| `history`               | `HistoricalEnvelope<StatsPoint[]>` | optional  | Present only when --since is passed    |

**Flags:**

- `--since <duration>`: Historical window. Format: <number><unit> where unit = m (minutes), h (hours), d (days). Max 30d (capped with stderr warning). Examples: 30m, 12h, 7d.
- `--json`: Force JSON output. Also active when stdout is not a TTY or CI=true.
- `--no-color`: Suppress ANSI colors in TTY output.
- `--no-cache`: Disable token cache; always re-authenticate.

**Examples:**

```sh
# System snapshot JSON
beszel system "Zima Blade" --json

# With 24h history
beszel system "Zima Blade" --since 24h --json

# Lookup by id
beszel system sys001homela --json

# Human TTY view
beszel system "Home Lab"
```

---

### `beszel containers`

**List containers across the fleet, sortable by cpu or memory, filterable by system.**

Usage: `beszel containers [options]`

**Output shape:** `{ "containers": ContainerInfo[] }`

**Fields:**

| Field                 | Type            | Stability | Description                                    |
| --------------------- | --------------- | --------- | ---------------------------------------------- |
| `containers[].name`   | `string`        | STABLE    | Container name                                 |
| `containers[].system` | `string`        | STABLE    | Parent system name                             |
| `containers[].status` | `string | null` | STABLE    | Status string (e.g. Up 2 days)                 |
| `containers[].health` | `number | null` | STABLE    | Health code (numeric; e.g. 0)                  |
| `containers[].cpuPct` | `number | null` | STABLE    | CPU %                                          |
| `containers[].memMB`  | `number | null` | STABLE    | Memory MB                                      |
| `containers[].image`  | `string | null` | STABLE    | Container image                                |
| `containers[].ports`  | `string`        | optional  | Port mapping string (when present in upstream) |

**Flags:**

- `--top <n>`: Limit results to top N items.
- `--sort <field>` — default: `cpu`: Sort field: cpu or memory.
- `--system <name>`: Filter containers to one system (by name or id).
- `--since <duration>`: Historical window (e.g. 30m, 12h, 7d).
- `--json`: Force JSON output. Also active when stdout is not a TTY or CI=true.
- `--no-color`: Suppress ANSI colors in TTY output.
- `--no-cache`: Disable token cache; always re-authenticate.

**Examples:**

```sh
# All containers JSON
beszel containers --json

# Top 10 by memory
beszel containers --top 10 --sort memory --json

# Filter by system
beszel containers --system "Home Lab" --json

# Human TTY view
beszel containers
```

---

### `beszel disks`

**List SMART disks and RAID arrays across the fleet. RAID entries include arrayState and syncAction.**

Usage: `beszel disks [options]`

**Output shape:** `{ "devices": Array<DiskInfo | RaidInfo> }`

**Fields:**

| Field                     | Type              | Stability | Description                                                    |
| ------------------------- | ----------------- | --------- | -------------------------------------------------------------- |
| `devices[].kind`          | `"disk" | "raid"` | STABLE    | Device type discriminator                                      |
| `devices[].name`          | `string`          | STABLE    | Device path (e.g. /dev/sda)                                    |
| `devices[].system`        | `string`          | STABLE    | Parent system name                                             |
| `devices[].state`         | `string | null`   | STABLE    | PASSED | FAILED (SMART overall state)                          |
| `devices[].model`         | `string | null`   | STABLE    | Disk model string [disk only]                                  |
| `devices[].tempC`         | `number | null`   | STABLE    | Temperature °C [disk only]                                     |
| `devices[].capacityBytes` | `number | null`   | STABLE    | Capacity in bytes [disk only]                                  |
| `devices[].type`          | `string | null`   | STABLE    | sat | nvme | scsi [disk only]                                  |
| `devices[].raidLevel`     | `string | null`   | STABLE    | e.g. raid5 [raid only]                                         |
| `devices[].arrayState`    | `string | null`   | STABLE    | clean | degraded | inactive | failed [raid only]               |
| `devices[].raidDisks`     | `number | null`   | STABLE    | Disk count in array [raid only]                                |
| `devices[].syncAction`    | `string | null`   | STABLE    | idle | resync | recover | check | repair | reshape [raid only] |
| `devices[].serial`        | `string`          | optional  | Serial number [disk only]                                      |
| `devices[].firmware`      | `string`          | optional  | Firmware revision [disk only]                                  |
| `devices[].hours`         | `number`          | optional  | Power-on hours [disk only]                                     |
| `devices[].cycles`        | `number`          | optional  | Power cycles [disk only]                                       |

**Flags:**

- `--system <name>`: Filter to one system (name or id).
- `--failing`: Show only failing devices: disks where state != PASSED, or RAID where arrayState != clean or syncAction != idle.
- `--json`: Force JSON output. Also active when stdout is not a TTY or CI=true.
- `--no-color`: Suppress ANSI colors in TTY output.
- `--no-cache`: Disable token cache; always re-authenticate.

**Examples:**

```sh
# All devices JSON
beszel disks --json

# Failing devices only
beszel disks --failing --json

# One system disks
beszel disks --system "Home Lab" --json

# Human TTY view
beszel disks
```

---

### `beszel temps`

**Show temperatures for all fleet systems. displayTempC is from the live snapshot; sensors is from the latest 1-minute stats bucket.**

Usage: `beszel temps [options]`

**Output shape:** `{ "systems": TempInfo[] }`

**Fields:**

| Field                    | Type                     | Stability | Description                                                                                                   |
| ------------------------ | ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------- |
| `systems[].system`       | `string`                 | STABLE    | System name                                                                                                   |
| `systems[].displayTempC` | `number | null`          | STABLE    | Display temp °C (systems.info.dt)                                                                             |
| `systems[].sensors`      | `Record<string, number>` | STABLE    | Sensor name → °C map (empty object when no 1m record). With --disks, disk temps are added as <dev>_temp keys. |

**Flags:**

- `--disks`: Include disk (SMART) temperatures merged into the sensors map as <deviceBase>_temp keys.
- `--json`: Force JSON output. Also active when stdout is not a TTY or CI=true.
- `--no-color`: Suppress ANSI colors in TTY output.
- `--no-cache`: Disable token cache; always re-authenticate.

**Examples:**

```sh
# All temps JSON
beszel temps --json

# Include disk temps
beszel temps --disks --json

# Human TTY view
beszel temps
```

---

### `beszel health`

**Evaluate fleet health across status, SMART state, RAID arrays, disk usage, and temperatures. Emits structured issues list. Exit 0 = healthy/warning-only; exit 1 = CRITICAL (or any issue with --strict).**

Usage: `beszel health [options]`

**Output shape:** `{ "healthy": boolean, "issues": HealthIssue[], "checked": number }`

**Fields:**

| Field               | Type                                          | Stability | Description                          |
| ------------------- | --------------------------------------------- | --------- | ------------------------------------ |
| `healthy`           | `boolean`                                     | STABLE    | true when issues is empty            |
| `issues`            | `HealthIssue[]`                               | STABLE    | Array of issues (empty = clean)      |
| `issues[].system`   | `string`                                      | STABLE    | System name where issue was detected |
| `issues[].severity` | `"crit" | "warn"`                             | STABLE    | Issue severity level                 |
| `issues[].kind`     | `"down" | "smart" | "raid" | "disk" | "temp"` | STABLE    | Issue category                       |
| `issues[].detail`   | `string`                                      | STABLE    | Human-readable description           |
| `checked`           | `number`                                      | STABLE    | Count of systems evaluated           |

**Flags:**

- `--disk-warn <pct>` (env: `BESZEL_DISK_WARN`) — default: `90`: Disk usage warning threshold %
- `--disk-crit <pct>` (env: `BESZEL_DISK_CRIT`) — default: `95`: Disk usage critical threshold %
- `--temp-warn <c>` (env: `BESZEL_TEMP_WARN`) — default: `80`: System temperature warning threshold °C
- `--temp-crit <c>` (env: `BESZEL_TEMP_CRIT`) — default: `90`: System temperature critical threshold °C
- `--disk-temp-warn <c>` (env: `BESZEL_DISK_TEMP_WARN`) — default: `55`: Disk temperature warning threshold °C
- `--disk-temp-crit <c>` (env: `BESZEL_DISK_TEMP_CRIT`) — default: `65`: Disk temperature critical threshold °C
- `--strict` (env: `BESZEL_STRICT`): Promote all warnings to critical. Exit 1 when any issue exists (not just CRITICAL).
- `--json`: Force JSON output. Also active when stdout is not a TTY or CI=true.
- `--no-color`: Suppress ANSI colors in TTY output.
- `--no-cache`: Disable token cache; always re-authenticate.

**Examples:**

```sh
# Fleet health JSON
beszel health --json

# Strict mode (any issue = exit 1)
beszel health --strict --json

# Custom disk threshold
beszel health --disk-warn 80 --disk-crit 90 --json

# Human TTY report
beszel health
```


---

## Exit Codes

| Code | Condition                                                                                                               | ErrorCode (in JSON)                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 0    | Success — healthy fleet or warning-only (no --strict)                                                                   | —                                                                      |
| 1    | Config/validation error (missing env, invalid threshold/duration) OR CRITICAL health issue OR --strict with any warning | CONFIG_MISSING | INVALID_THRESHOLD | INVALID_DURATION | INTERNAL_ERROR |
| 2    | Authentication failed (bad credentials or expired session)                                                              | AUTH_FAILED                                                            |
| 3    | System not found or ambiguous (multiple name matches)                                                                   | NOT_FOUND | AMBIGUOUS_SYSTEM                                           |
| 4    | Network error (ECONNREFUSED, timeout, 5xx, non-JSON response)                                                           | NETWORK_ERROR                                                          |

**Important notes on `beszel health` exit codes:**
- `healthy: false` + exit `0` = warning-only fleet (CI passes; check `healthy` for agent decisions).
- `healthy: false` + exit `1` = CRITICAL issues or `--strict` mode active.
- Agents should check `healthy` field, NOT just the exit code, for nuanced decisions.

---

## Error Envelope

All non-zero exits emit one JSON object to stdout:

```json
{
  "error": {
    "code":    "<string — machine-readable ErrorCode>",
    "message": "<string — human-readable description>",
    "hint":    "<string — actionable suggestion>"
  }
}
```

Stderr carries human-readable diagnostics (warnings, clamp notices) and is NOT valid JSON.

---

## Environment Variables

| Variable                 | Required | Description                                  |
| ------------------------ | -------- | -------------------------------------------- |
| `BESZEL_URL`             | required | Hub URL, e.g. https://beszel.example.com     |
| `BESZEL_EMAIL`           | required | Login email                                  |
| `BESZEL_PASSWORD`        | required | Login password                               |
| `BESZEL_AUTH_COLLECTION` | optional | PocketBase collection name (default "users") |

Token cache is stored at `~/.cache/beszel-cli/token.json` (mode 600).
Use `--no-cache` to bypass it (e.g. in CI).

---

## Field Stability Contract

- **STABLE**: Always present in JSON output. May be `null` when the upstream snapshot does not include the source field.
- **optional**: Present in output only when the upstream agent snapshot includes it. Key is omitted (not null) when absent.
- Unknown upstream fields are silently dropped (never cause errors — schema uses `looseObject`).

---

## --since Duration Format

Accepted units: `m` (minutes), `h` (hours), `d` (days).
Examples: `30m`, `12h`, `7d`.

Windows ≤ 1.5h → 1-minute buckets.
Windows > 30d are clamped to 30d with a stderr warning; exit code stays 0.

---

## System Resolution (beszel system)

Name lookup is **case-insensitive** (e.g. "zima blade" matches "Zima Blade").
Falls back to exact `id` match if no name match found.
If multiple systems share the same name (case-insensitively): exit 3, `AMBIGUOUS_SYSTEM`, with matching ids in `hint`.

---

## Worked Agent Examples

```sh
# Check if fleet is healthy before deploying
beszel health --json | jq '.healthy'

# Get CPU % for a specific system
beszel system "Zima Blade" --json | jq '.system.cpu'

# Correlate system and container stats over last 24h
beszel system "Home Lab" --since 24h --json
beszel containers --system "Home Lab" --since 24h --json

# Find hot disks
beszel temps --disks --json | jq '[.systems[].sensors | to_entries[] | select(.value > 50)]'

# Alert on RAID issues
beszel disks --failing --json | jq '.devices[] | select(.kind == "raid")'

# Check health with custom thresholds
beszel health --disk-warn 80 --disk-crit 90 --strict --json
```

# beszel-cli — Read-only Beszel monitoring CLI

Query a [Beszel](https://beszel.dev) monitoring hub from your terminal or AI agent scripts.
All commands are **read-only**. Outputs clean JSON for scripting or human TTY tables with color.

Compatible with Beszel agent range: `>=0.18 <0.19`.

---

## Quick Start

### 1. Install

```sh
# Clone and install with Yarn Berry
git clone https://github.com/your-org/beszel-cli.git
cd beszel-cli
yarn install
yarn build

# Optional: link globally
yarn link
```

### 2. Configure

```sh
export BESZEL_URL=https://beszel.example.com
export BESZEL_EMAIL=admin@example.com
export BESZEL_PASSWORD=secret
# Optional: if your auth collection is not "users"
# export BESZEL_AUTH_COLLECTION=admins
```

### 3. Run

```sh
# Health check — exit 0 = ok, exit 1 = CRITICAL
beszel health --json

# List all systems
beszel systems --json

# Human TTY tables (no --json flag)
beszel systems
beszel health
```

---

## Commands

| Command | Purpose |
|---------|---------|
| `beszel systems` | List all fleet systems with live snapshot metrics |
| `beszel system <name>` | Detail for one system (add `--since 24h` for history) |
| `beszel containers` | List containers across the fleet |
| `beszel disks` | List SMART disks and RAID arrays |
| `beszel temps` | Temperature summary per system |
| `beszel health` | Fleet health evaluation with structured issues |

**Global flags** (available on all commands):

- `--json` — Force JSON output (also active when stdout is not a TTY or `CI=true`)
- `--no-color` — Suppress ANSI colors in TTY output
- `--no-cache` — Disable token cache; always re-authenticate

---

## Examples

```sh
# Check fleet health before a deploy
beszel health --json | jq '.healthy'

# System detail with 24-hour history
beszel system "Home Lab" --since 24h --json

# Top 5 containers by memory
beszel containers --top 5 --sort memory --json

# Show failing disks and RAID arrays
beszel disks --failing --json

# Temperatures including disk sensors
beszel temps --disks --json

# Health with custom thresholds (strict mode: any issue = exit 1)
beszel health --disk-warn 80 --disk-crit 90 --strict --json
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (healthy fleet, or warning-only without `--strict`) |
| 1 | Critical health issue, or config/validation error |
| 2 | Authentication failed |
| 3 | System not found or ambiguous |
| 4 | Network error (unreachable hub) |

---

## For AI Agents

See **`skill.md`** at the repo root for the full agent-facing reference:
- Complete JSON output shapes per command (STABLE vs optional fields)
- Error envelope schema `{ error: { code, message, hint } }`
- Flag and environment variable reference
- Worked `jq` examples for common agent tasks

```sh
# Quick agent pattern: check healthy, then get system info
beszel health --json | jq -e '.healthy'  # exits 1 if not healthy
beszel system "Zima Blade" --json | jq '.system.cpu'
```

---

## Development

```sh
yarn build       # compile TypeScript → dist/cli.js
yarn typecheck   # tsc --noEmit
yarn lint        # eslint src
yarn test        # vitest run
yarn gen:skill   # regenerate skill.md from registry
yarn check:skill # CI: fail if skill.md is stale
```

Full CI pipeline:

```sh
yarn build && yarn typecheck && yarn lint && yarn test && yarn check:skill
```

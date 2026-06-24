/**
 * scripts/check-skill.ts — CI staleness check for skill.md.
 *
 * Regenerates skill.md content in-memory and diffs it against the committed
 * file. Exits nonzero if stale (content mismatch) or missing.
 *
 * Usage:
 *   tsx scripts/check-skill.ts         (run as part of CI)
 *   yarn check:skill                   (npm script alias)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMAND_REGISTRY,
  GLOBAL_FLAGS,
  EXIT_CODE_TABLE,
  ERROR_ENVELOPE_SCHEMA,
  ENV_VARS,
  SUPPORTED_BESZEL_RANGE,
  type CommandContract,
  type FieldDef,
  type FlagDef,
} from "../src/command-contract/registry.js";

// ---------------------------------------------------------------------------
// Inline renderer (copy of gen-skill logic — avoids a circular import cycle
// when this script is run via tsx without a prior build step).
// ---------------------------------------------------------------------------

function mdTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const sep = colWidths.map((w) => "-".repeat(w)).join(" | ");
  const header = headers.map((h, i) => h.padEnd(colWidths[i]!)).join(" | ");
  const body = rows
    .map((r) => r.map((cell, i) => (cell ?? "").padEnd(colWidths[i]!)).join(" | "))
    .join("\n");
  return `| ${header} |\n| ${sep} |\n${body
    .split("\n")
    .map((l) => `| ${l} |`)
    .join("\n")}`;
}

function renderFlags(flags: FlagDef[], indent = ""): string {
  if (flags.length === 0) return `${indent}_none_`;
  return flags
    .map((f) => {
      const arg = f.argLabel ? ` ${f.argLabel}` : "";
      const envNote = f.env ? ` (env: \`${f.env}\`)` : "";
      const defNote = f.defaultValue ? ` — default: \`${f.defaultValue}\`` : "";
      return `${indent}- \`${f.flag}${arg}\`${envNote}${defNote}: ${f.description}`;
    })
    .join("\n");
}

function renderCommandSection(cmd: CommandContract): string {
  const stableFields = cmd.outputFields.filter((f: FieldDef) => f.stability === "stable");
  const optionalFields = cmd.outputFields.filter((f: FieldDef) => f.stability === "optional");

  const fieldRows = stableFields.map((f: FieldDef) => [
    `\`${f.name}\``,
    `\`${f.type}\``,
    "STABLE",
    f.description,
  ]);
  for (const f of optionalFields) {
    fieldRows.push([`\`${f.name}\``, `\`${f.type}\``, "optional", f.description]);
  }

  const exampleLines = Object.entries(cmd.examples)
    .map(([label, c]) => `# ${label}\n${c}`)
    .join("\n\n");

  const allFlags = [...cmd.flags, ...GLOBAL_FLAGS];

  return `### \`beszel ${cmd.name}\`

**${cmd.purpose}**

Usage: \`${cmd.usage}\`

**Output shape:** \`${cmd.outputShape}\`

**Fields:**

${mdTable(["Field", "Type", "Stability", "Description"], fieldRows)}

**Flags:**

${renderFlags(allFlags, "")}

**Examples:**

\`\`\`sh
${exampleLines}
\`\`\`
`;
}

function renderSkillMd(): string {
  const commandRows = COMMAND_REGISTRY.map((cmd) => [
    `\`beszel ${cmd.name}\``,
    cmd.purpose,
    cmd.outputShape,
  ]);

  const commandSections = COMMAND_REGISTRY.map(renderCommandSection).join("\n---\n\n");

  const exitCodeRows = EXIT_CODE_TABLE.map((e) => [
    String(e.code),
    e.condition,
    e.errorCode ?? "—",
  ]);

  const envRows = ENV_VARS.map((e) => [
    `\`${e.name}\``,
    e.required ? "required" : "optional",
    e.description,
  ]);

  return `# beszel — Agent Skill Reference

> Machine-generated from the command-contract registry. Do NOT hand-edit.
> Beszel version range: \`${SUPPORTED_BESZEL_RANGE}\` (out-of-range → stderr warning, never an error).

This skill enables an AI agent to query a Beszel monitoring hub via the \`beszel\` CLI.
All commands are **read-only**. JSON mode is always safe to use with \`--json\`.

---

## Quick Start

\`\`\`sh
# Set required environment variables once per session
export BESZEL_URL=https://beszel.example.com
export BESZEL_EMAIL=admin@example.com
export BESZEL_PASSWORD=secret

# Verify connectivity
beszel health --json

# List all systems
beszel systems --json
\`\`\`

---

## Command Reference

${mdTable(
  ["Command", "Purpose", "JSON output shape"],
  commandRows,
)}

---

## Command Detail

${commandSections}

---

## Exit Codes

${mdTable(["Code", "Condition", "ErrorCode (in JSON)"], exitCodeRows)}

**Important notes on \`beszel health\` exit codes:**
- \`healthy: false\` + exit \`0\` = warning-only fleet (CI passes; check \`healthy\` for agent decisions).
- \`healthy: false\` + exit \`1\` = CRITICAL issues or \`--strict\` mode active.
- Agents should check \`healthy\` field, NOT just the exit code, for nuanced decisions.

---

## Error Envelope

All non-zero exits emit one JSON object to stdout:

\`\`\`json
${ERROR_ENVELOPE_SCHEMA}
\`\`\`

Stderr carries human-readable diagnostics (warnings, clamp notices) and is NOT valid JSON.

---

## Environment Variables

${mdTable(["Variable", "Required", "Description"], envRows)}

Token cache is stored at \`~/.cache/beszel-cli/token.json\` (mode 600).
Use \`--no-cache\` to bypass it (e.g. in CI).

---

## Field Stability Contract

- **STABLE**: Always present in JSON output. May be \`null\` when the upstream snapshot does not include the source field.
- **optional**: Present in output only when the upstream agent snapshot includes it. Key is omitted (not null) when absent.
- Unknown upstream fields are silently dropped (never cause errors — schema uses \`looseObject\`).

---

## --since Duration Format

Accepted units: \`m\` (minutes), \`h\` (hours), \`d\` (days).
Examples: \`30m\`, \`12h\`, \`7d\`.

Windows ≤ 1.5h → 1-minute buckets.
Windows > 30d are clamped to 30d with a stderr warning; exit code stays 0.

---

## System Resolution (beszel system)

Name lookup is **case-insensitive** (e.g. "zima blade" matches "Zima Blade").
Falls back to exact \`id\` match if no name match found.
If multiple systems share the same name (case-insensitively): exit 3, \`AMBIGUOUS_SYSTEM\`, with matching ids in \`hint\`.

---

## Worked Agent Examples

\`\`\`sh
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
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const skillPath = path.join(repoRoot, "skill.md");

const expected = renderSkillMd();

if (!fs.existsSync(skillPath)) {
  process.stderr.write(
    `[check-skill] FAIL: skill.md does not exist at ${skillPath}\n` +
      `  Run: yarn gen:skill\n`,
  );
  process.exit(1);
}

const actual = fs.readFileSync(skillPath, "utf-8");

if (actual !== expected) {
  // Show first differing line for diagnostics
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const maxLen = Math.max(expectedLines.length, actualLines.length);
  let firstDiff = -1;
  for (let i = 0; i < maxLen; i++) {
    if (expectedLines[i] !== actualLines[i]) {
      firstDiff = i + 1; // 1-based line number
      break;
    }
  }

  process.stderr.write(
    `[check-skill] FAIL: skill.md is stale (first diff at line ${firstDiff}).\n` +
      `  Run: yarn gen:skill\n`,
  );
  process.exit(1);
}

process.stdout.write(`[check-skill] OK: skill.md is up-to-date.\n`);

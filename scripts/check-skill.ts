import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderSkillMd } from "./render-skill.js";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");
const skillPath = path.join(repoRoot, "SKILL.md");

const expected = renderSkillMd();

if (!fs.existsSync(skillPath)) {
  process.stderr.write(
    `[check-skill] FAIL: SKILL.md does not exist at ${skillPath}\n` +
      `  Run: yarn gen:skill\n`,
  );
  process.exit(1);
}

const actual = fs.readFileSync(skillPath, "utf-8");

if (actual !== expected) {
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
    `[check-skill] FAIL: SKILL.md is stale (first diff at line ${firstDiff}).\n` +
      `  Run: yarn gen:skill\n`,
  );
  process.exit(1);
}

process.stdout.write(`[check-skill] OK: SKILL.md is up-to-date.\n`);

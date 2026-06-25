import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderSkillMd } from "./render-skill.js";

const dryRun = process.argv.includes("--dry-run");
const content = renderSkillMd();

if (dryRun) {
  process.stdout.write(content);
} else {
  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..");
  const outPath = path.join(repoRoot, "SKILL.md");
  fs.writeFileSync(outPath, content, "utf-8");
  process.stderr.write(`[gen-skill] Written ${content.length} bytes → ${outPath}\n`);
}

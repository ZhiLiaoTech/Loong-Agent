#!/usr/bin/env node
// Seed a preset digital employee into the Loong data root.
//
//   pnpm seed:employee                      # seed the bundled content-creator
//   node scripts/seed-employee.mjs <dir>    # seed a specific suite directory
//
// Honours LOONG_DATA_ROOT; otherwise resolves the nearest `.loong` (repo root).

import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { installSuite, resolveLoongDataRoot } from "../packages/suite/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const defaultPreset = path.join(repoRoot, "packages/suite/presets/content-creator");

const suiteDir = process.argv[2] ?? defaultPreset;
if (!existsSync(suiteDir)) {
  console.error(`Suite directory not found: ${suiteDir}`);
  console.error("Pass a suite directory: node scripts/seed-employee.mjs <dir>");
  process.exit(1);
}

const dataRoot = process.env.LOONG_DATA_ROOT ?? resolveLoongDataRoot();

const result = await installSuite(suiteDir, { dataRoot });

console.log(`✓ Seeded digital employee: ${result.manifest.name} (profile: ${result.profileId})`);
console.log(`  data root:  ${dataRoot}`);
console.log(`  workspace:  ${result.workspaceDir}`);
console.log(`  skills:     ${result.skillsCopied.length}   crons: ${result.cronsImported}`);
if (result.orgEmployeeId) {
  console.log(`  org员工:    ${result.orgEmployeeId}`);
}
console.log(`  agents.json: ${path.join(dataRoot, "config", "agents.json")}`);
console.log(`\n用 \`loong agent --profile ${result.profileId} "..."\` 即可驱动该数字员工。`);

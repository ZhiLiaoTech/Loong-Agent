import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(packageRoot, "preset-skills");
const target = path.join(packageRoot, "dist", "preset-skills");

if (!fs.existsSync(source)) {
  throw new Error(`Missing preset-skills bundle at ${source}`);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });

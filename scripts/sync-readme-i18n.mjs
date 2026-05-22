#!/usr/bin/env node
/**
 * Keep README.zh_CN.md in sync with README.md (简体中文主文档).
 * Run: node scripts/sync-readme-i18n.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "README.md");
const dest = path.join(root, "README.zh_CN.md");
fs.copyFileSync(src, dest);
console.log("Synced README.md -> README.zh_CN.md");

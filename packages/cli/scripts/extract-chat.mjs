import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const implPath = path.join(src, "cli-impl.ts");
const lines = fs.readFileSync(implPath, "utf8").split(/\r?\n/);

function slice(start, end) {
  return lines.slice(start, end).join("\n");
}

const mapsStart = lines.findIndex(l => l.includes("TEXT_FILE_EXTENSIONS"));
const mapsEnd = lines.findIndex((l, i) => i > mapsStart && l === "});") + 1; // wrong
// find readAttachment end
const readAttachStart = lines.findIndex(l => l.startsWith("async function readAttachmentFromDisk"));
const readAttachEnd = lines.findIndex((l, i) => i > readAttachStart && l === "}");

const parseChatStart = lines.findIndex(l => l === "interface ParsedChatArgs {");
const parseHelpersEnd = lines.findIndex((l, i) => i > parseChatStart && l === "type SkillsSlashCommand =");

const runChatStart = lines.findIndex(l => l === "export async function runChat(mode: \"chat\" | \"agent\", args: string[]): Promise<void> {");
let depth = 0;
let runChatEnd = runChatStart;
for (let i = runChatStart; i < lines.length; i += 1) {
  for (const ch of lines[i]) {
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
  }
  if (i > runChatStart && depth === 0) {
    runChatEnd = i + 1;
    break;
  }
}

const attachmentsTs = `import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DragonAttachment } from "@dragon/core";

const TEXT_FILE_EXTENSIONS = new Map<string, string>([
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".txt", "text/plain"],
  [".log", "text/plain"],
  [".csv", "text/csv"],
  [".tsv", "text/csv"],
  [".html", "text/html"],
  [".htm", "text/html"],
  [".css", "text/css"],
  [".js", "text/javascript"],
  [".mjs", "text/javascript"],
  [".cjs", "text/javascript"],
  [".ts", "text/plain"],
  [".tsx", "text/plain"],
  [".jsx", "text/javascript"],
  [".py", "text/x-python"],
  [".json", "application/json"],
  [".jsonl", "application/json"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
  [".xml", "application/xml"],
  [".rs", "text/plain"],
  [".go", "text/plain"],
  [".rb", "text/plain"],
  [".sh", "text/plain"],
  [".sql", "text/plain"],
]);
const IMAGE_FILE_EXTENSIONS = new Map<string, string>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
]);
const DOCUMENT_FILE_EXTENSIONS = new Map<string, string>([
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".doc", "application/msword"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".xls", "application/vnd.ms-excel"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".rtf", "application/rtf"],
]);

export async function readAttachmentFromDisk(filePath: string): Promise<DragonAttachment> {
${slice(readAttachStart + 1, readAttachEnd).replace(/^async function readAttachmentFromDisk/, "").trim().split("\n").map(l => "  " + l).join("\n")}
}
`;

const chatArgsBody = slice(parseChatStart, parseHelpersEnd)
  .replace(/^interface ParsedChatArgs/, "export interface ParsedChatArgs")
  .replace(/^interface ParsedAttachmentSpec/, "export interface ParsedAttachmentSpec")
  .replace(/^function parseChatArgs/, "export function parseChatArgs")
  .replace(/^function parseQueryLoopMaxTurns/, "function parseQueryLoopMaxTurns")
  .replace(/^function parseTierName/, "function parseTierName")
  .replace(/^function parseListEnv/, "function parseListEnv");

const chatArgsHeader = `import path from "node:path";
import type { DragonTierHint } from "@dragon/core";
import { configuredPluginRoots, configuredSkillRoots, resolveExistingPluginRoot, resolveSkillRoot, uniquePaths } from "./cli-impl.js";

`;

fs.writeFileSync(path.join(src, "attachments.ts"), attachmentsTs);
fs.writeFileSync(path.join(src, "chat-args.ts"), chatArgsHeader + chatArgsBody + "\n");

// Remove circular import - paths should be in paths.ts
console.log("Note: fix chat-args imports - use paths module");

const removals = [[runChatStart, runChatEnd], [parseChatStart, parseHelpersEnd], [mapsStart, readAttachEnd]].sort((a, b) => b[0] - a[0]);
let newLines = [...lines];
for (const [s, e] of removals) {
  if (s >= 0 && e > s) newLines.splice(s, e - s);
}
fs.writeFileSync(implPath, `${newLines.join("\n")}\n`);
console.log("cli-impl lines:", newLines.length);

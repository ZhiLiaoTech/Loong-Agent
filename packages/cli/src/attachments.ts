import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoongAttachment } from "@loong/core";

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

export async function readAttachmentFromDisk(filePath: string): Promise<LoongAttachment> {
  const absolute = path.resolve(filePath);
  const buffer = await readFile(absolute);
  const ext = path.extname(absolute).toLowerCase();
  const name = path.basename(absolute);
  const imageMime = IMAGE_FILE_EXTENSIONS.get(ext);
  if (imageMime) {
    return { kind: "image", mimeType: imageMime, data: buffer.toString("base64"), name, size: buffer.byteLength };
  }
  const documentMime = DOCUMENT_FILE_EXTENSIONS.get(ext);
  if (documentMime) {
    return { kind: "document", mimeType: documentMime, data: buffer.toString("base64"), name, size: buffer.byteLength };
  }
  const textMime = TEXT_FILE_EXTENSIONS.get(ext) ?? "text/plain";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`--attach: ${filePath} is not a UTF-8 text file (and its extension is not a known image / pdf / docx / xlsx / pptx / rtf type).`);
  }
  return { kind: "text", mimeType: textMime, data: buffer.toString("base64"), name, size: buffer.byteLength };
}

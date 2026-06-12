import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

export interface DownloadOptions {
  /** Bearer token for the download request. */
  token?: string;
  /** Expected byte size; mismatch fails the download. */
  fileSize?: number;
  /** Download attempts before giving up (default 3). */
  retries?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Download a suite ZIP with Bearer auth, retry/backoff and size verification. */
export async function downloadSuitePackage(url: string, options: DownloadOptions = {}): Promise<Buffer> {
  const retries = options.retries ?? 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const headers: Record<string, string> = {};
      if (options.token) {
        headers.Authorization = `Bearer ${options.token}`;
      }
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`download failed: HTTP ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (options.fileSize !== undefined && options.fileSize > 0 && buffer.length !== options.fileSize) {
        throw new Error(`size mismatch: expected ${options.fileSize}, got ${buffer.length}`);
      }
      return buffer;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(attempt * 1000);
      }
    }
  }

  throw new Error(
    `failed to download suite after ${retries} attempt(s): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

// --- Minimal ZIP reader (stored + deflate) using only node:zlib ---------------
// Sizes/offsets are taken from the central directory (authoritative even when a
// local header uses a data descriptor). ZIP64 is not supported (suites are small).

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function findCentralDirectoryOffset(buf: Buffer): number {
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      return buf.readUInt32LE(i + 16);
    }
  }
  throw new Error("not a zip file (end-of-central-directory not found)");
}

function readCentralDirectory(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let p = findCentralDirectoryOffset(buf);
  while (p + 4 <= buf.length && buf.readUInt32LE(p) === SIG_CENTRAL) {
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntryData(buf: Buffer, entry: ZipEntry): Buffer {
  const p = entry.localHeaderOffset;
  if (buf.readUInt32LE(p) !== SIG_LOCAL) {
    throw new Error(`bad local header for ${entry.name}`);
  }
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const dataStart = p + 30 + nameLen + extraLen;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) {
    return Buffer.from(compressed);
  }
  if (entry.method === 8) {
    return inflateRawSync(compressed);
  }
  throw new Error(`unsupported zip compression method ${entry.method} for ${entry.name}`);
}

/** Extract a ZIP buffer into `destDir`, rejecting any path-traversal entries. */
export async function extractZipBuffer(buffer: Buffer, destDir: string): Promise<void> {
  const root = path.resolve(destDir);
  await fs.mkdir(root, { recursive: true });

  for (const entry of readCentralDirectory(buffer)) {
    const target = path.resolve(root, entry.name);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      throw new Error(`zip entry escapes extract dir: ${entry.name}`);
    }
    if (entry.name.endsWith("/")) {
      await fs.mkdir(target, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, readEntryData(buffer, entry));
  }
}

let tempCounter = 0;

function makeTempDir(): string {
  tempCounter += 1;
  return path.join(os.tmpdir(), `loong-suite-${process.pid}-${Date.now()}-${tempCounter}`);
}

/** Extract a ZIP buffer into a fresh temp directory and return its path. */
export async function extractZipToTempDir(buffer: Buffer): Promise<string> {
  const dir = makeTempDir();
  await extractZipBuffer(buffer, dir);
  return dir;
}

/** Download a suite ZIP and extract it into a fresh temp directory. */
export async function downloadAndExtractSuite(url: string, options: DownloadOptions = {}): Promise<string> {
  return extractZipToTempDir(await downloadSuitePackage(url, options));
}

/** Read a local ZIP file and extract it into a fresh temp directory. */
export async function extractZipFileToTempDir(zipPath: string): Promise<string> {
  return extractZipToTempDir(await fs.readFile(zipPath));
}

// --- Catalog / reporting (server side; ClawWorks-compatible) ------------------

export interface SuiteInfo {
  suiteCode: string;
  suiteName: string;
  description: string;
  version: string;
  requiredPlan?: string;
  tags: string[];
  icon?: string;
}

export interface FetchSuitesOptions {
  /** API base, e.g. `https://www.clawworks.cn`. */
  baseUrl: string;
  token: string;
  platform?: string;
  clientVersion?: string;
  activeSuite?: string;
}

/** GET /api/suites/digest — lightweight entitlement digest for change detection. */
export async function fetchSuiteDigest(options: FetchSuitesOptions): Promise<string> {
  try {
    const res = await fetch(`${options.baseUrl}/api/suites/digest`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${options.token}` },
    });
    if (!res.ok) {
      return "";
    }
    const data = (await res.json()) as { data?: { digest?: unknown } };
    return typeof data.data?.digest === "string" ? data.data.digest : "";
  } catch {
    return "";
  }
}

/** GET /api/suites/available — list installable suites for the current plan. */
export async function fetchAvailableSuites(options: FetchSuitesOptions): Promise<SuiteInfo[]> {
  const params = new URLSearchParams();
  if (options.platform) params.set("platform", options.platform);
  if (options.clientVersion) params.set("clientVersion", options.clientVersion);
  if (options.activeSuite) params.set("activeSuite", options.activeSuite);

  try {
    const res = await fetch(`${options.baseUrl}/api/suites/available?${params.toString()}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${options.token}` },
    });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { success?: boolean; data?: unknown };
    if (data.success === false) {
      return [];
    }
    const payload = data.data;
    const rows: Array<Record<string, unknown>> = Array.isArray(payload)
      ? (payload as Array<Record<string, unknown>>)
      : Array.isArray((payload as { suites?: unknown })?.suites)
        ? ((payload as { suites: Array<Record<string, unknown>> }).suites)
        : [];

    const out: SuiteInfo[] = [];
    for (const row of rows) {
      const code = typeof row.suiteCode === "string" ? row.suiteCode : typeof row.id === "string" ? row.id : "";
      if (!code) {
        continue;
      }
      out.push({
        suiteCode: code,
        suiteName:
          typeof row.suiteName === "string" ? row.suiteName : typeof row.name === "string" ? row.name : code,
        description: typeof row.description === "string" ? row.description : "",
        version: typeof row.version === "string" ? row.version : "0.0.0",
        ...(typeof row.requiredPlan === "string" ? { requiredPlan: row.requiredPlan } : {}),
        tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
        ...(typeof row.icon === "string" ? { icon: row.icon } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export interface SuiteReportOptions {
  /** API base, e.g. `https://www.clawworks.cn`. */
  baseUrl: string;
  token: string;
  version?: string;
  platform?: string;
  clientVersion?: string;
}

async function postReport(url: string, options: SuiteReportOptions, body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${options.token}`,
      },
      body: JSON.stringify({
        ...body,
        ...(options.version !== undefined ? { version: options.version } : {}),
        ...(options.platform !== undefined ? { platform: options.platform } : {}),
        ...(options.clientVersion !== undefined ? { clientVersion: options.clientVersion } : {}),
      }),
    });
  } catch {
    // best-effort; reporting failures are non-critical
  }
}

export async function reportSuiteLoaded(suiteCode: string, options: SuiteReportOptions): Promise<void> {
  await postReport(`${options.baseUrl}/api/suites/${suiteCode}/loaded`, options, {});
}

export async function reportSuiteLoadError(
  suiteCode: string,
  errorMessage: string,
  options: SuiteReportOptions,
): Promise<void> {
  await postReport(`${options.baseUrl}/api/suites/${suiteCode}/load-error`, options, { errorMsg: errorMessage });
}

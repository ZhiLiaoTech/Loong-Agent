import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PairedDeviceRecord {
  id: string;
  label: string;
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

export interface PairingTokenRecord {
  token: string;
  label: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
}

export interface PairingFileData {
  devices: PairedDeviceRecord[];
  pendingTokens: PairingTokenRecord[];
}

export interface PairingStore {
  createToken(label: string, ttlMs?: number): Promise<{ token: string; expiresAt: string }>;
  consumeToken(token: string): Promise<PairedDeviceRecord | undefined>;
  listDevices(): Promise<PairedDeviceRecord[]>;
  revokeDevice(deviceId: string): Promise<boolean>;
  touchDevice(deviceId: string): Promise<void>;
}

const DEFAULT_TOKEN_TTL_MS = 15 * 60 * 1000;

export function defaultPairingFilePath(cwd = process.cwd()): string {
  return path.join(cwd, ".dragon", "pairing", "devices.json");
}

export class FilePairingStore implements PairingStore {
  readonly #filePath: string;
  readonly #tokenTtlMs: number;

  constructor(options: { filePath?: string; tokenTtlMs?: number } = {}) {
    this.#filePath = options.filePath ?? defaultPairingFilePath();
    this.#tokenTtlMs = options.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS;
  }

  async createToken(label: string, ttlMs?: number): Promise<{ token: string; expiresAt: string }> {
    const normalizedLabel = label.trim() || "device";
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + (ttlMs ?? this.#tokenTtlMs)).toISOString();
    const token = randomBytes(24).toString("hex");
    const data = await this.#load();
    data.pendingTokens.push({ token, label: normalizedLabel, createdAt, expiresAt });
    await this.#save(data);
    return { token, expiresAt };
  }

  async consumeToken(token: string): Promise<PairedDeviceRecord | undefined> {
    const trimmed = token.trim();
    if (!trimmed) {
      return undefined;
    }
    const data = await this.#load();
    const now = Date.now();
    const pending = data.pendingTokens.find(entry => entry.token === trimmed && !entry.consumedAt);
    if (!pending) {
      return undefined;
    }
    if (Date.parse(pending.expiresAt) < now) {
      return undefined;
    }
    pending.consumedAt = new Date().toISOString();
    const device: PairedDeviceRecord = {
      id: `device_${randomBytes(8).toString("hex")}`,
      label: pending.label,
      createdAt: pending.consumedAt,
      lastSeenAt: pending.consumedAt,
    };
    data.devices.push(device);
    data.pendingTokens = data.pendingTokens.filter(entry => {
      if (entry.consumedAt) {
        return true;
      }
      return Date.parse(entry.expiresAt) >= now;
    });
    await this.#save(data);
    return device;
  }

  async listDevices(): Promise<PairedDeviceRecord[]> {
    const data = await this.#load();
    return data.devices
      .filter(device => device.revokedAt === undefined)
      .map(device => ({ ...device }));
  }

  async revokeDevice(deviceId: string): Promise<boolean> {
    const data = await this.#load();
    const device = data.devices.find(entry => entry.id === deviceId && entry.revokedAt === undefined);
    if (!device) {
      return false;
    }
    device.revokedAt = new Date().toISOString();
    await this.#save(data);
    return true;
  }

  async touchDevice(deviceId: string): Promise<void> {
    const data = await this.#load();
    const device = data.devices.find(entry => entry.id === deviceId && entry.revokedAt === undefined);
    if (!device) {
      return;
    }
    device.lastSeenAt = new Date().toISOString();
    await this.#save(data);
  }

  async #load(): Promise<PairingFileData> {
    try {
      const raw = await readFile(this.#filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { devices: [], pendingTokens: [] };
      }
      const record = parsed as Record<string, unknown>;
      return {
        devices: Array.isArray(record.devices) ? record.devices.filter(isDeviceRecord) : [],
        pendingTokens: Array.isArray(record.pendingTokens) ? record.pendingTokens.filter(isTokenRecord) : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { devices: [], pendingTokens: [] };
      }
      throw error;
    }
  }

  async #save(data: PairingFileData): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    await writeFile(this.#filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }
}

function isDeviceRecord(value: unknown): value is PairedDeviceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.label === "string"
    && typeof record.createdAt === "string";
}

function isTokenRecord(value: unknown): value is PairingTokenRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.token === "string"
    && typeof record.label === "string"
    && typeof record.createdAt === "string"
    && typeof record.expiresAt === "string";
}

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import {
  MultipartUploadCoordinator,
  type CreateMultipartUploadInput,
  type MultipartObjectMetadata,
  type MultipartUploadPartState,
  type MultipartUploadSession,
  type SignedPartUpload,
} from "./object-storage.js";
import { resolveWithin } from "./paths.js";
import { assertSafeId } from "./validation.js";

const SAFE_USER_ID = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,199}$/;

export type StorageAccessRole = "uploader" | "reviewer" | "operator" | "admin";

export interface StoragePrincipal {
  tenantId: string;
  userId: string;
  roles: StorageAccessRole[];
}

export interface SignedObjectDownload {
  url: string;
  method: "GET";
  headers: Record<string, string>;
  expiresAt: string;
}

export interface ObjectStorageDownloadProvider {
  signObjectDownload(input: {
    objectKey: string;
    expiresInSeconds: number;
    downloadFileName: string;
  }): Promise<SignedObjectDownload>;
}

export type StorageAuditAction =
  | "upload.create"
  | "upload.status"
  | "upload.part.sign"
  | "upload.part.confirm"
  | "upload.complete"
  | "upload.abort"
  | "download.sign";

export interface StorageAuditRecord {
  schemaVersion: "1.0";
  auditId: string;
  occurredAt: string;
  tenantId: string;
  actorUserId: string;
  actorRoles: StorageAccessRole[];
  action: StorageAuditAction;
  outcome: "allowed" | "denied" | "failed";
  resourceId: string;
  requestId?: string;
  errorCode?: string;
}

function validatePrincipal(principal: StoragePrincipal): StoragePrincipal {
  assertSafeId(principal.tenantId, "tenantId");
  if (!SAFE_USER_ID.test(principal.userId)) throw new CookingVideoError("ACCESS_DENIED", "Authenticated user identity is invalid.");
  const roles = [...new Set(principal.roles)];
  if (roles.length === 0 || roles.some(role => !(["uploader", "reviewer", "operator", "admin"] as string[]).includes(role))) {
    throw new CookingVideoError("ACCESS_DENIED", "Authenticated user has no valid storage role.");
  }
  return { ...principal, roles };
}

function isOperator(principal: StoragePrincipal): boolean {
  return principal.roles.includes("operator") || principal.roles.includes("admin");
}

function deny(message: string): never {
  throw new CookingVideoError("ACCESS_DENIED", message);
}

export class StorageAuditLog {
  readonly #root: string;
  #tail: Promise<void> = Promise.resolve();

  constructor(root: string) {
    this.#root = path.resolve(root);
  }

  async append(record: StorageAuditRecord): Promise<void> {
    validatePrincipal({ tenantId: record.tenantId, userId: record.actorUserId, roles: record.actorRoles });
    const day = record.occurredAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new CookingVideoError("AUDIT_FAILED", "Audit timestamp is invalid.");
    const file = resolveWithin(this.#root, path.join(record.tenantId, `${day}.jsonl`));
    const write = this.#tail.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      await appendFile(file, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    });
    this.#tail = write.catch(() => undefined);
    try {
      await write;
    } catch (error) {
      throw new CookingVideoError("AUDIT_FAILED", "Storage audit record could not be persisted.", { cause: error instanceof Error ? error.message : String(error) });
    }
  }

  async list(tenantId: string, day: string): Promise<StorageAuditRecord[]> {
    assertSafeId(tenantId, "tenantId");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new CookingVideoError("AUDIT_FAILED", "Audit day must use YYYY-MM-DD.");
    const file = resolveWithin(this.#root, path.join(tenantId, `${day}.jsonl`));
    try {
      return (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as StorageAuditRecord);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new CookingVideoError("AUDIT_FAILED", "Storage audit records could not be read.", { cause: error instanceof Error ? error.message : String(error) });
    }
  }
}

export interface TenantObjectStorageServiceOptions {
  now?: () => Date;
}

export class TenantObjectStorageService {
  readonly #uploads: MultipartUploadCoordinator;
  readonly #downloads: ObjectStorageDownloadProvider;
  readonly #audit: StorageAuditLog;
  readonly #now: () => Date;

  constructor(uploads: MultipartUploadCoordinator, downloads: ObjectStorageDownloadProvider, audit: StorageAuditLog, options: TenantObjectStorageServiceOptions = {}) {
    this.#uploads = uploads;
    this.#downloads = downloads;
    this.#audit = audit;
    this.#now = options.now ?? (() => new Date());
  }

  async createUpload(principalInput: StoragePrincipal, input: Omit<CreateMultipartUploadInput, "tenantId" | "ownerUserId">, requestId?: string): Promise<MultipartUploadSession> {
    const principal = validatePrincipal(principalInput);
    return this.#run(principal, "upload.create", input.jobId, requestId, async () => {
      if (!principal.roles.includes("uploader") && !isOperator(principal)) deny("The caller cannot create uploads.");
      return this.#uploads.create({ ...input, tenantId: principal.tenantId, ownerUserId: principal.userId });
    });
  }

  async getUpload(principalInput: StoragePrincipal, uploadId: string, requestId?: string): Promise<MultipartUploadSession> {
    const principal = validatePrincipal(principalInput);
    return this.#run(principal, "upload.status", uploadId, requestId, async () => {
      const session = await this.#ownedSession(principal, uploadId, true);
      return session;
    });
  }

  async signUploadPart(principalInput: StoragePrincipal, uploadId: string, partNumber: number, sha256: string, expiresInSeconds?: number, requestId?: string): Promise<SignedPartUpload> {
    const principal = validatePrincipal(principalInput);
    return this.#run(principal, "upload.part.sign", uploadId, requestId, async () => {
      await this.#ownedSession(principal, uploadId);
      return this.#uploads.signPart(uploadId, partNumber, sha256, expiresInSeconds);
    });
  }

  async confirmUploadPart(principalInput: StoragePrincipal, uploadId: string, partNumber: number, requestId?: string): Promise<MultipartUploadPartState> {
    const principal = validatePrincipal(principalInput);
    return this.#run(principal, "upload.part.confirm", uploadId, requestId, async () => {
      await this.#ownedSession(principal, uploadId);
      return this.#uploads.confirmPart(uploadId, partNumber);
    });
  }

  async completeUpload(principalInput: StoragePrincipal, uploadId: string, requestId?: string): Promise<MultipartObjectMetadata> {
    const principal = validatePrincipal(principalInput);
    return this.#run(principal, "upload.complete", uploadId, requestId, async () => {
      await this.#ownedSession(principal, uploadId);
      return this.#uploads.complete(uploadId);
    });
  }

  async abortUpload(principalInput: StoragePrincipal, uploadId: string, requestId?: string): Promise<MultipartUploadSession> {
    const principal = validatePrincipal(principalInput);
    return this.#run(principal, "upload.abort", uploadId, requestId, async () => {
      await this.#ownedSession(principal, uploadId);
      return this.#uploads.abort(uploadId);
    });
  }

  async signDownload(principalInput: StoragePrincipal, uploadId: string, expiresInSeconds = 300, requestId?: string): Promise<SignedObjectDownload> {
    const principal = validatePrincipal(principalInput);
    return this.#run(principal, "download.sign", uploadId, requestId, async () => {
      if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 3600) throw new CookingVideoError("UPLOAD_INVALID", "Download expiry must be between 60 and 3600 seconds.");
      const session = await this.#ownedSession(principal, uploadId, true);
      if (session.status !== "completed" || !session.completedObject) throw new CookingVideoError("UPLOAD_INVALID", "Only completed objects can be downloaded.");
      if (!principal.roles.includes("reviewer") && !isOperator(principal) && session.ownerUserId !== principal.userId) deny("The caller cannot download this object.");
      let signed: SignedObjectDownload;
      try {
        signed = await this.#downloads.signObjectDownload({ objectKey: session.completedObject.objectKey, expiresInSeconds, downloadFileName: session.fileName });
      } catch (error) {
        throw new CookingVideoError("UPLOAD_PROVIDER_FAILED", "Object storage download signing failed.", { cause: error instanceof Error ? error.message : String(error) });
      }
      if (signed.method !== "GET" || !/^https:\/\//.test(signed.url)) throw new CookingVideoError("UPLOAD_PROVIDER_FAILED", "Object storage returned an invalid signed download target.");
      const expiresAt = Date.parse(signed.expiresAt);
      const now = this.#now().getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt > now + expiresInSeconds * 1000 + 5000) {
        throw new CookingVideoError("UPLOAD_PROVIDER_FAILED", "Object storage returned an invalid download expiration.");
      }
      return signed;
    });
  }

  async #ownedSession(principal: StoragePrincipal, uploadId: string, allowReviewer = false): Promise<MultipartUploadSession> {
    let session: MultipartUploadSession;
    try {
      session = await this.#uploads.get(uploadId);
    } catch (error) {
      if (error instanceof CookingVideoError && error.code === "UPLOAD_INVALID") deny("The upload is not accessible to the authenticated principal.");
      throw error;
    }
    if (session.tenantId !== principal.tenantId) deny("The upload is not accessible to the authenticated principal.");
    if (isOperator(principal)) return session;
    if (allowReviewer && principal.roles.includes("reviewer")) return session;
    if (!principal.roles.includes("uploader") || session.ownerUserId !== principal.userId) deny("The upload is not accessible to the authenticated principal.");
    return session;
  }

  async #run<T>(principal: StoragePrincipal, action: StorageAuditAction, resourceId: string, requestId: string | undefined, operation: () => Promise<T>): Promise<T> {
    try {
      const result = await operation();
      await this.#record(principal, action, "allowed", resourceId, requestId);
      return result;
    } catch (error) {
      const outcome = error instanceof CookingVideoError && error.code === "ACCESS_DENIED" ? "denied" : "failed";
      await this.#record(principal, action, outcome, resourceId, requestId, error instanceof CookingVideoError ? error.code : "UNEXPECTED");
      throw error;
    }
  }

  async #record(principal: StoragePrincipal, action: StorageAuditAction, outcome: StorageAuditRecord["outcome"], resourceId: string, requestId?: string, errorCode?: string): Promise<void> {
    await this.#audit.append({
      schemaVersion: "1.0",
      auditId: randomUUID(),
      occurredAt: this.#now().toISOString(),
      tenantId: principal.tenantId,
      actorUserId: principal.userId,
      actorRoles: [...principal.roles].sort(),
      action,
      outcome,
      resourceId,
      ...(requestId ? { requestId } : {}),
      ...(errorCode ? { errorCode } : {}),
    });
  }
}

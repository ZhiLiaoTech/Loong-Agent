import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { CookingVideoError } from "./errors.js";
import { readJsonFile, writeJsonAtomic } from "./json-files.js";
import { resolveWithin } from "./paths.js";
import { assertSafeId } from "./validation.js";

const SHA256 = /^[a-f0-9]{64}$/;
const MIN_PART_SIZE = 1024 * 1024;
const MAX_PART_SIZE = 512 * 1024 * 1024;
const MAX_PARTS = 10_000;

export interface MultipartObjectMetadata {
  objectKey: string;
  byteSize: number;
  sha256: string;
  etag?: string;
}

export interface SignedPartUpload {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

export interface VerifiedUploadPart {
  partNumber: number;
  byteSize: number;
  sha256: string;
  etag: string;
}

export interface ObjectStorageMultipartProvider {
  createMultipartUpload(input: {
    objectKey: string;
    contentType: string;
    byteSize: number;
    sha256: string;
  }): Promise<{ providerUploadId: string }>;
  signPartUpload(input: {
    providerUploadId: string;
    objectKey: string;
    partNumber: number;
    byteSize: number;
    sha256: string;
    expiresInSeconds: number;
  }): Promise<SignedPartUpload>;
  inspectUploadedPart(input: {
    providerUploadId: string;
    objectKey: string;
    partNumber: number;
  }): Promise<VerifiedUploadPart>;
  completeMultipartUpload(input: {
    providerUploadId: string;
    objectKey: string;
    parts: VerifiedUploadPart[];
    byteSize: number;
    sha256: string;
  }): Promise<MultipartObjectMetadata>;
  abortMultipartUpload(input: { providerUploadId: string; objectKey: string }): Promise<void>;
}

export type MultipartUploadStatus = "created" | "uploading" | "completed" | "aborted" | "failed";

export interface MultipartUploadPartState {
  partNumber: number;
  byteSize: number;
  sha256: string;
  status: "signed" | "verified";
  etag?: string;
  verifiedAt?: string;
}

export interface MultipartUploadSession {
  schemaVersion: "1.0";
  uploadId: string;
  providerUploadId: string;
  tenantId: string;
  jobId: string;
  assetId: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  partSize: number;
  partCount: number;
  status: MultipartUploadStatus;
  parts: MultipartUploadPartState[];
  createdAt: string;
  updatedAt: string;
  completedObject?: MultipartObjectMetadata;
  failure?: string;
}

export interface CreateMultipartUploadInput {
  tenantId: string;
  jobId: string;
  assetId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  partSize?: number;
}

function assertDigest(value: string, label: string): void {
  if (!SHA256.test(value)) throw new CookingVideoError("UPLOAD_INVALID", `${label} must be a lowercase SHA-256 digest.`);
}

function validateFileName(value: string): string {
  if (!value || value.length > 255 || value === "." || value === ".." || value !== path.basename(value) || /[\\/\0-\x1f]/.test(value)) {
    throw new CookingVideoError("UPLOAD_INVALID", "fileName must be a safe base filename.");
  }
  return value;
}

function validatePartSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < MIN_PART_SIZE || value > MAX_PART_SIZE) {
    throw new CookingVideoError("UPLOAD_INVALID", `partSize must be an integer from ${MIN_PART_SIZE} to ${MAX_PART_SIZE} bytes.`);
  }
  return value;
}

function expectedPartSize(session: MultipartUploadSession, partNumber: number): number {
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.partCount) {
    throw new CookingVideoError("UPLOAD_INVALID", `partNumber must be between 1 and ${session.partCount}.`);
  }
  return partNumber === session.partCount
    ? session.byteSize - session.partSize * (session.partCount - 1)
    : session.partSize;
}

function providerFailure(action: string, error: unknown): CookingVideoError {
  if (error instanceof CookingVideoError) return error;
  return new CookingVideoError("UPLOAD_PROVIDER_FAILED", `Object storage ${action} failed.`, {
    cause: error instanceof Error ? error.message : String(error),
  });
}

export function buildTenantObjectKey(input: Pick<CreateMultipartUploadInput, "tenantId" | "jobId" | "assetId" | "fileName">): string {
  assertSafeId(input.tenantId, "tenantId");
  assertSafeId(input.jobId, "jobId");
  assertSafeId(input.assetId, "assetId");
  return [input.tenantId, input.jobId, input.assetId, validateFileName(input.fileName)].join("/");
}

export class MultipartUploadCoordinator {
  readonly #stateRoot: string;
  readonly #provider: ObjectStorageMultipartProvider;
  readonly #now: () => Date;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(stateRoot: string, provider: ObjectStorageMultipartProvider, options: { now?: () => Date } = {}) {
    this.#stateRoot = path.resolve(stateRoot);
    this.#provider = provider;
    this.#now = options.now ?? (() => new Date());
  }

  async create(input: CreateMultipartUploadInput): Promise<MultipartUploadSession> {
    const objectKey = buildTenantObjectKey(input);
    if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) throw new CookingVideoError("UPLOAD_INVALID", "byteSize must be a positive safe integer.");
    assertDigest(input.sha256, "sha256");
    if (!input.contentType || input.contentType.length > 255 || /[\r\n]/.test(input.contentType)) throw new CookingVideoError("UPLOAD_INVALID", "contentType is invalid.");
    const partSize = validatePartSize(input.partSize ?? 8 * 1024 * 1024);
    const partCount = Math.ceil(input.byteSize / partSize);
    if (partCount > MAX_PARTS) throw new CookingVideoError("UPLOAD_INVALID", `Upload exceeds the ${MAX_PARTS}-part limit; increase partSize.`);
    let remote: { providerUploadId: string };
    try {
      remote = await this.#provider.createMultipartUpload({ objectKey, contentType: input.contentType, byteSize: input.byteSize, sha256: input.sha256 });
    } catch (error) {
      throw providerFailure("initialization", error);
    }
    if (!remote.providerUploadId || remote.providerUploadId.length > 1024) {
      if (remote.providerUploadId) await this.#provider.abortMultipartUpload({ providerUploadId: remote.providerUploadId, objectKey }).catch(() => undefined);
      throw new CookingVideoError("UPLOAD_PROVIDER_FAILED", "Object storage returned an invalid upload identifier.");
    }
    const now = this.#now().toISOString();
    const session: MultipartUploadSession = {
      schemaVersion: "1.0",
      uploadId: randomUUID(),
      providerUploadId: remote.providerUploadId,
      tenantId: input.tenantId,
      jobId: input.jobId,
      assetId: input.assetId,
      objectKey,
      fileName: input.fileName,
      contentType: input.contentType,
      byteSize: input.byteSize,
      sha256: input.sha256,
      partSize,
      partCount,
      status: "created",
      parts: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.#save(session);
    } catch (error) {
      await this.#provider.abortMultipartUpload({ providerUploadId: session.providerUploadId, objectKey }).catch(() => undefined);
      throw error;
    }
    return structuredClone(session);
  }

  async get(uploadId: string): Promise<MultipartUploadSession> {
    const file = this.#sessionFile(uploadId);
    try {
      const session = await readJsonFile<MultipartUploadSession>(file);
      if (session.schemaVersion !== "1.0" || session.uploadId !== uploadId) throw new Error("session identity mismatch");
      return session;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new CookingVideoError("UPLOAD_INVALID", `Upload session ${uploadId} was not found.`);
      if (error instanceof CookingVideoError) throw error;
      throw new CookingVideoError("UPLOAD_INVALID", `Upload session ${uploadId} is corrupt.`, { cause: error instanceof Error ? error.message : String(error) });
    }
  }

  async signPart(uploadId: string, partNumber: number, sha256: string, expiresInSeconds = 900): Promise<SignedPartUpload> {
    return this.#exclusive(uploadId, async () => {
      const session = await this.get(uploadId);
      this.#assertMutable(session);
      assertDigest(sha256, "part sha256");
      if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 3600) throw new CookingVideoError("UPLOAD_INVALID", "expiresInSeconds must be between 60 and 3600.");
      const byteSize = expectedPartSize(session, partNumber);
      const existing = session.parts.find(part => part.partNumber === partNumber);
      if (existing?.status === "verified") {
        if (existing.sha256 !== sha256) throw new CookingVideoError("UPLOAD_INTEGRITY_FAILED", `Part ${partNumber} is already verified with a different digest.`);
        throw new CookingVideoError("UPLOAD_INVALID", `Part ${partNumber} is already verified.`);
      }
      let signed: SignedPartUpload;
      try {
        signed = await this.#provider.signPartUpload({ providerUploadId: session.providerUploadId, objectKey: session.objectKey, partNumber, byteSize, sha256, expiresInSeconds });
      } catch (error) {
        throw providerFailure("part signing", error);
      }
      if (signed.method !== "PUT" || !signed.url || !/^https?:\/\//.test(signed.url)) throw new CookingVideoError("UPLOAD_PROVIDER_FAILED", "Object storage returned an invalid signed upload target.");
      const next: MultipartUploadPartState = { partNumber, byteSize, sha256, status: "signed" };
      session.parts = [...session.parts.filter(part => part.partNumber !== partNumber), next].sort((a, b) => a.partNumber - b.partNumber);
      session.status = "uploading";
      session.updatedAt = this.#now().toISOString();
      await this.#save(session);
      return signed;
    });
  }

  async confirmPart(uploadId: string, partNumber: number): Promise<MultipartUploadPartState> {
    return this.#exclusive(uploadId, async () => {
      const session = await this.get(uploadId);
      this.#assertMutable(session);
      expectedPartSize(session, partNumber);
      const expected = session.parts.find(part => part.partNumber === partNumber);
      if (!expected) throw new CookingVideoError("UPLOAD_INVALID", `Part ${partNumber} has not been signed.`);
      if (expected.status === "verified") return structuredClone(expected);
      let actual: VerifiedUploadPart;
      try {
        actual = await this.#provider.inspectUploadedPart({ providerUploadId: session.providerUploadId, objectKey: session.objectKey, partNumber });
      } catch (error) {
        throw providerFailure("part inspection", error);
      }
      if (actual.partNumber !== partNumber || actual.byteSize !== expected.byteSize || actual.sha256 !== expected.sha256 || !actual.etag) {
        throw new CookingVideoError("UPLOAD_INTEGRITY_FAILED", `Part ${partNumber} does not match its signed size and checksum.`);
      }
      Object.assign(expected, { status: "verified", etag: actual.etag, verifiedAt: this.#now().toISOString() });
      session.updatedAt = this.#now().toISOString();
      await this.#save(session);
      return structuredClone(expected);
    });
  }

  async complete(uploadId: string): Promise<MultipartObjectMetadata> {
    return this.#exclusive(uploadId, async () => {
      const session = await this.get(uploadId);
      if (session.status === "completed" && session.completedObject) return structuredClone(session.completedObject);
      this.#assertMutable(session);
      const parts = [...session.parts].sort((a, b) => a.partNumber - b.partNumber);
      if (parts.length !== session.partCount || parts.some((part, index) => part.partNumber !== index + 1 || part.status !== "verified" || !part.etag)) {
        throw new CookingVideoError("UPLOAD_INVALID", "Every expected part must be verified before completion.");
      }
      const verifiedParts = parts.map(part => ({ partNumber: part.partNumber, byteSize: part.byteSize, sha256: part.sha256, etag: part.etag! }));
      let metadata: MultipartObjectMetadata;
      try {
        metadata = await this.#provider.completeMultipartUpload({ providerUploadId: session.providerUploadId, objectKey: session.objectKey, parts: verifiedParts, byteSize: session.byteSize, sha256: session.sha256 });
      } catch (error) {
        throw providerFailure("completion", error);
      }
      if (metadata.objectKey !== session.objectKey || metadata.byteSize !== session.byteSize || metadata.sha256 !== session.sha256) {
        session.status = "failed";
        session.failure = "Completed object metadata did not match the declared key, size, or SHA-256.";
        session.updatedAt = this.#now().toISOString();
        await this.#save(session);
        throw new CookingVideoError("UPLOAD_INTEGRITY_FAILED", session.failure);
      }
      session.status = "completed";
      session.completedObject = metadata;
      session.updatedAt = this.#now().toISOString();
      await this.#save(session);
      return structuredClone(metadata);
    });
  }

  async abort(uploadId: string): Promise<MultipartUploadSession> {
    return this.#exclusive(uploadId, async () => {
      const session = await this.get(uploadId);
      if (session.status === "completed") throw new CookingVideoError("UPLOAD_INVALID", "A completed upload cannot be aborted.");
      if (session.status !== "aborted") {
        try {
          await this.#provider.abortMultipartUpload({ providerUploadId: session.providerUploadId, objectKey: session.objectKey });
        } catch (error) {
          throw providerFailure("abort", error);
        }
        session.status = "aborted";
        session.updatedAt = this.#now().toISOString();
        await this.#save(session);
      }
      return structuredClone(session);
    });
  }

  #assertMutable(session: MultipartUploadSession): void {
    if (session.status === "completed" || session.status === "aborted" || session.status === "failed") {
      throw new CookingVideoError("UPLOAD_INVALID", `Upload ${session.uploadId} is ${session.status}.`);
    }
  }

  #sessionFile(uploadId: string): string {
    if (!/^[a-f0-9-]{36}$/.test(uploadId)) throw new CookingVideoError("UPLOAD_INVALID", "uploadId is invalid.");
    return resolveWithin(this.#stateRoot, path.join("multipart", `${uploadId}.json`));
  }

  async #save(session: MultipartUploadSession): Promise<void> {
    await mkdir(path.dirname(this.#sessionFile(session.uploadId)), { recursive: true });
    await writeJsonAtomic(this.#sessionFile(session.uploadId), session);
    const metadata = await stat(this.#sessionFile(session.uploadId));
    if (!metadata.isFile()) throw new CookingVideoError("UPLOAD_INVALID", "Upload session was not persisted.");
  }

  async #exclusive<T>(uploadId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(uploadId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => current);
    this.#locks.set(uploadId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(uploadId) === queued) this.#locks.delete(uploadId);
    }
  }
}

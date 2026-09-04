import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { CookingVideoError } from "./errors.js";
import { resolveExistingWithin, type JobPaths } from "./paths.js";
import type { CookingVideoJob } from "./types.js";

async function updateFromFile(hash: ReturnType<typeof createHash>, file: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", resolve);
  });
}

export async function computeJobInputDigest(job: CookingVideoJob, paths: JobPaths): Promise<string> {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(job));
  try {
    const files = await Promise.all([
      ...job.sources.map(source => resolveExistingWithin(paths.root, source.path)),
      ...(job.machineEventsPath ? [resolveExistingWithin(paths.root, job.machineEventsPath)] : []),
    ]);
    for (const file of files.sort()) {
      hash.update("\0");
      hash.update(file.toLowerCase());
      hash.update("\0");
      await updateFromFile(hash, file);
    }
  } catch (error) {
    throw new CookingVideoError("MEDIA_UNREADABLE", "Unable to hash one or more job inputs.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return hash.digest("hex");
}

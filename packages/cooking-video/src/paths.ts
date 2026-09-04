import path from "node:path";
import { realpath } from "node:fs/promises";
import { CookingVideoError } from "./errors.js";
import { assertSafeId } from "./validation.js";

export interface JobPaths {
  root: string;
  input: string;
  proxy: string;
  frames: string;
  analysis: string;
  edit: string;
  output: string;
  state: string;
  jobFile: string;
  stateFile: string;
  eventsFile: string;
}

export function resolveWithin(root: string, candidate: string): string {
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, candidate);
  const relative = path.relative(absoluteRoot, resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolved;
  }
  throw new CookingVideoError("PATH_OUTSIDE_JOB", `Path escapes approved root: ${candidate}.`);
}

export async function resolveExistingWithin(root: string, candidate: string): Promise<string> {
  const lexicalPath = resolveWithin(root, candidate);
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(lexicalPath)]);
  try {
    return resolveWithin(realRoot, realCandidate);
  } catch {
    throw new CookingVideoError("PATH_OUTSIDE_JOB", `Path resolves outside approved root: ${candidate}.`);
  }
}

export function jobPaths(jobsRoot: string, jobId: string): JobPaths {
  assertSafeId(jobId, "jobId");
  const root = resolveWithin(jobsRoot, jobId);
  return {
    root,
    input: path.join(root, "input"),
    proxy: path.join(root, "proxy"),
    frames: path.join(root, "frames"),
    analysis: path.join(root, "analysis"),
    edit: path.join(root, "edit"),
    output: path.join(root, "output"),
    state: path.join(root, "state"),
    jobFile: path.join(root, "job.json"),
    stateFile: path.join(root, "state", "job-state.json"),
    eventsFile: path.join(root, "state", "events.jsonl"),
  };
}

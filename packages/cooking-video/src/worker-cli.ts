#!/usr/bin/env node
import { JobStore } from "./job-store.js";
import { executeCookingVideoWorkerTask, type CookingVideoWorkerAction, type CookingVideoWorkerRole } from "./worker-runtime.js";

function value(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const role = (value(args, "--role") ?? process.env.LOONG_COOKING_VIDEO_WORKER_ROLE) as CookingVideoWorkerRole | undefined;
  const action = value(args, "--action") as CookingVideoWorkerAction | undefined;
  const jobsRoot = value(args, "--jobs-root") ?? process.env.LOONG_COOKING_VIDEO_JOBS_ROOT;
  const jobId = value(args, "--job");
  const taskId = value(args, "--task-id");
  const expectedStatus = value(args, "--expected-status");
  if (!role || !action || !jobsRoot || !jobId || !taskId || !expectedStatus) {
    throw new Error("Usage: loong-cooking-video-worker --role <media|model|render> --action <action> --jobs-root <path> --job <id> --task-id <id> --expected-status <status>");
  }
  const result = await executeCookingVideoWorkerTask(new JobStore(jobsRoot), role, {
    schemaVersion: "1.0",
    taskId,
    jobId,
    role,
    action,
    expectedStatus: expectedStatus as never,
  }, {
    approved: args.includes("--approved"),
    draft: args.includes("--draft"),
    allowAlignedStart: args.includes("--allow-aligned-start"),
    template: value(args, "--template") as "15s" | "30s" | undefined,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

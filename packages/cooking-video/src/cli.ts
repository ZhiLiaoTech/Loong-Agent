#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CookingVideoError } from "./errors.js";
import { computeJobInputDigest } from "./digest.js";
import { detectMachineEvents } from "./event-detection.js";
import { createJobEdit } from "./editing.js";
import { JobStore } from "./job-store.js";
import { runJobPipeline } from "./job-runner.js";
import { ingestMedia } from "./media.js";
import { selectJobShots } from "./shot-selection.js";
import { renderJob } from "./render.js";
import { reviewVideo } from "./quality.js";
import { synchronizeJob } from "./sync.js";
import { importJobVisionResponse, prepareVisionEvidence } from "./vision-evidence.js";

interface CliOptions {
  command?: string;
  jobId?: string;
  jobFile?: string;
  jobsRoot: string;
  skipProxy: boolean;
  skipContactSheet: boolean;
  referenceCameraId?: string;
  manualOffsets: Record<string, number>;
  template?: "15s" | "30s";
  draft: boolean;
  approved: boolean;
  videoFile?: string;
  responseFile?: string;
  timeoutMs?: number;
}

function usage(): string {
  return [
    "Usage:",
    "  loong-cooking-video create --job-file <path> [--jobs-root <path>]",
    "  loong-cooking-video status --job <jobId> [--jobs-root <path>]",
    "  loong-cooking-video ingest --job <jobId> [--jobs-root <path>] [--skip-proxy] [--skip-contact-sheet]",
    "  loong-cooking-video sync --job <jobId> [--jobs-root <path>] [--reference <cameraId>] [--offset <cameraId>=<milliseconds>]...",
    "  loong-cooking-video detect --job <jobId> [--jobs-root <path>]",
    "  loong-cooking-video prepare-vision --job <jobId> [--jobs-root <path>]",
    "  loong-cooking-video import-vision --job <jobId> --response <job-relative JSON path> [--jobs-root <path>]",
    "  loong-cooking-video select --job <jobId> [--jobs-root <path>]",
    "  loong-cooking-video edit --job <jobId> [--jobs-root <path>] [--template 15s|30s]",
    "  loong-cooking-video render --job <jobId> [--jobs-root <path>] [--approved] [--draft]",
    "  loong-cooking-video review --job <jobId> --video <output filename> [--jobs-root <path>]",
    "  loong-cooking-video run --job <jobId> [pipeline options]",
    "  loong-cooking-video resume --job <jobId> [pipeline options]",
    "Pipeline options: --reference <camera> --offset <camera>=<ms> --template 15s|30s --approved --draft --timeout-ms <ms>",
  ].join("\n");
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    command: argv[0],
    jobsRoot: path.resolve("data", "jobs"),
    skipProxy: false,
    skipContactSheet: false,
    manualOffsets: {},
    draft: false,
    approved: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--job") options.jobId = argv[++index];
    else if (arg === "--job-file") options.jobFile = argv[++index];
    else if (arg === "--jobs-root") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new CookingVideoError("JOB_INVALID", "--jobs-root requires a path value.");
      options.jobsRoot = path.resolve(value);
    }
    else if (arg === "--skip-proxy") options.skipProxy = true;
    else if (arg === "--skip-contact-sheet") options.skipContactSheet = true;
    else if (arg === "--reference") options.referenceCameraId = argv[++index];
    else if (arg === "--offset") {
      const value = argv[++index] ?? "";
      const match = /^([A-Za-z0-9][A-Za-z0-9_-]{0,63})=(-?\d+)$/.exec(value);
      if (!match) throw new CookingVideoError("SYNC_INPUT_INVALID", `Invalid --offset value: ${value}.`);
      options.manualOffsets[match[1]] = Number(match[2]);
    }
    else if (arg === "--template") {
      const value = argv[++index];
      if (value !== "15s" && value !== "30s") throw new CookingVideoError("EDIT_CONSTRAINT_VIOLATION", `Unsupported template: ${value}.`);
      options.template = value;
    }
    else if (arg === "--draft") options.draft = true;
    else if (arg === "--approved") options.approved = true;
    else if (arg === "--video") {
      const value = argv[++index] ?? "";
      if (value !== path.basename(value) || !value.toLowerCase().endsWith(".mp4")) {
        throw new CookingVideoError("JOB_INVALID", "--video must be an MP4 filename inside output/.");
      }
      options.videoFile = value;
    }
    else if (arg === "--response") options.responseFile = argv[++index];
    else if (arg === "--timeout-ms") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1000 || value > 86_400_000) throw new CookingVideoError("JOB_INVALID", "--timeout-ms must be between 1000 and 86400000.");
      options.timeoutMs = value;
    }
    else throw new CookingVideoError("JOB_INVALID", `Unknown argument: ${arg}.`);
  }
  return options;
}

export async function runCookingVideo(argv: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const store = new JobStore(options.jobsRoot);
  if (options.command === "create") {
    if (!options.jobFile) throw new CookingVideoError("JOB_INVALID", "--job-file is required.");
    const raw = JSON.parse(await readFile(path.resolve(options.jobFile), "utf8")) as unknown;
    const result = await store.create(raw);
    process.stdout.write(`${JSON.stringify({ jobId: result.job.jobId, status: result.state.status, root: result.paths.root }, null, 2)}\n`);
    return;
  }
  if (options.command === "status") {
    if (!options.jobId) throw new CookingVideoError("JOB_INVALID", "--job is required.");
    const result = await store.load(options.jobId);
    process.stdout.write(`${JSON.stringify(result.state, null, 2)}\n`);
    return;
  }
  if (options.command === "ingest") {
    if (!options.jobId) throw new CookingVideoError("JOB_INVALID", "--job is required.");
    const result = await store.load(options.jobId);
    const inputDigest = await computeJobInputDigest(result.job, result.paths);
    await store.transition(options.jobId, "ingesting", { inputDigest });
    try {
      const manifest = await ingestMedia(result.job, result.paths, {
        generateProxy: !options.skipProxy,
        generateContactSheet: !options.skipContactSheet,
      });
      await store.transition(options.jobId, "ingested", {
        outputFiles: ["analysis/media-manifest.json", "analysis/scene-cuts.json", ...manifest.sources.flatMap(source => [source.proxyPath, source.contactSheetPath].filter((value): value is string => Boolean(value)))],
      });
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    } catch (error) {
      const code = error instanceof CookingVideoError ? error.code : "PROCESS_FAILED";
      await store.transition(options.jobId, "failed", {
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return;
  }
  if (options.command === "sync") {
    if (!options.jobId) throw new CookingVideoError("JOB_INVALID", "--job is required.");
    const result = await store.load(options.jobId);
    await store.transition(options.jobId, "syncing");
    try {
      const syncMap = await synchronizeJob(result.paths, {
        referenceCameraId: options.referenceCameraId,
        manualOffsets: Object.keys(options.manualOffsets).length === 0 ? undefined : options.manualOffsets,
      });
      await store.transition(options.jobId, "synced", { outputFiles: ["analysis/sync-map.json"] });
      process.stdout.write(`${JSON.stringify(syncMap, null, 2)}\n`);
    } catch (error) {
      const code = error instanceof CookingVideoError ? error.code : "PROCESS_FAILED";
      await store.transition(options.jobId, "failed", {
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return;
  }
  if (options.command === "detect") {
    if (!options.jobId) throw new CookingVideoError("JOB_INVALID", "--job is required.");
    const result = await store.load(options.jobId);
    await store.transition(options.jobId, "analyzing");
    try {
      const timeline = await detectMachineEvents(result.job, result.paths);
      await store.transition(options.jobId, "analyzed", { outputFiles: ["analysis/event-timeline.json", ...timeline.events.flatMap(event => event.evidenceFrames)] });
      process.stdout.write(`${JSON.stringify(timeline, null, 2)}\n`);
    } catch (error) {
      const code = error instanceof CookingVideoError ? error.code : "PROCESS_FAILED";
      await store.transition(options.jobId, "failed", {
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return;
  }
  if (options.command === "prepare-vision") {
    if (!options.jobId) throw new CookingVideoError("JOB_INVALID", "--job is required.");
    const result = await store.load(options.jobId);
    await store.transition(options.jobId, "analyzing");
    try {
      const request = await prepareVisionEvidence(result.paths);
      process.stdout.write(`${JSON.stringify(request, null, 2)}\n`);
    } catch (error) {
      const code = error instanceof CookingVideoError ? error.code : "PROCESS_FAILED";
      await store.transition(options.jobId, "failed", { errorCode: code, errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    return;
  }
  if (options.command === "import-vision") {
    if (!options.jobId || !options.responseFile) throw new CookingVideoError("JOB_INVALID", "--job and --response are required.");
    const result = await store.load(options.jobId);
    if (result.state.status !== "analyzing") throw new CookingVideoError("JOB_STATE_INVALID", `Vision import requires analyzing state, got ${result.state.status}.`);
    try {
      const timeline = await importJobVisionResponse(result.paths, options.responseFile);
      await store.transition(options.jobId, "analyzed", { outputFiles: ["analysis/event-timeline.json"] });
      process.stdout.write(`${JSON.stringify(timeline, null, 2)}\n`);
    } catch (error) {
      const code = error instanceof CookingVideoError ? error.code : "VISION_RESPONSE_INVALID";
      await store.transition(options.jobId, "failed", { errorCode: code, errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    return;
  }
  if (options.command === "select") {
    if (!options.jobId) throw new CookingVideoError("JOB_INVALID", "--job is required.");
    const result = await store.load(options.jobId);
    await store.transition(options.jobId, "selecting");
    try {
      const candidates = await selectJobShots(result.paths);
      await store.transition(options.jobId, "selected", { outputFiles: ["analysis/shot-candidates.json"] });
      process.stdout.write(`${JSON.stringify(candidates, null, 2)}\n`);
    } catch (error) {
      const code = error instanceof CookingVideoError ? error.code : "PROCESS_FAILED";
      await store.transition(options.jobId, "failed", {
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return;
  }
  if (options.command === "edit") {
    if (!options.jobId) throw new CookingVideoError("JOB_INVALID", "--job is required.");
    const result = await store.load(options.jobId);
    await store.transition(options.jobId, "editing");
    try {
      const decision = await createJobEdit(result.paths, result.job, options.template);
      await store.transition(options.jobId, "awaiting_review", {
        outputFiles: ["edit/edit-decision.json", "edit/render-props.json", "edit/captions.srt"],
      });
      process.stdout.write(`${JSON.stringify(decision, null, 2)}\n`);
    } catch (error) {
      const code = error instanceof CookingVideoError ? error.code : "PROCESS_FAILED";
      await store.transition(options.jobId, "failed", {
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return;
  }
  if (options.command === "render") {
    if (!options.jobId) throw new CookingVideoError("JOB_INVALID", "--job is required.");
    const result = await store.load(options.jobId);
    if (result.job.brief.requireHumanApproval === true && !options.approved) {
      throw new CookingVideoError("APPROVAL_REQUIRED", "This job requires explicit --approved before rendering.");
    }
    await store.transition(options.jobId, "rendering");
    try {
      const rendered = await renderJob(result.job, result.paths, { approved: options.approved, draft: options.draft });
      await store.transition(options.jobId, "validating", { outputFiles: [rendered.relativeOutputPath] });
      process.stdout.write(`${JSON.stringify(rendered, null, 2)}\n`);
    } catch (error) {
      const code = error instanceof CookingVideoError ? error.code : "RENDER_FAILED";
      await store.transition(options.jobId, "failed", {
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    return;
  }
  if (options.command === "review") {
    if (!options.jobId || !options.videoFile) throw new CookingVideoError("JOB_INVALID", "--job and --video are required.");
    const result = await store.load(options.jobId);
    if (result.state.status !== "validating") {
      throw new CookingVideoError("JOB_STATE_INVALID", `Review requires validating state, got ${result.state.status}.`);
    }
    try {
      const report = await reviewVideo(options.jobId, result.paths, options.videoFile);
      if (report.status === "fail") {
        await store.transition(options.jobId, "failed", {
          errorCode: "QUALITY_GATE_FAILED",
          errorMessage: "One or more quality checks failed.",
          outputFiles: ["output/quality-report.json"],
        });
      } else {
        await store.transition(options.jobId, "completed", { outputFiles: ["output/quality-report.json"] });
      }
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.status === "fail") throw new CookingVideoError("QUALITY_GATE_FAILED", "One or more quality checks failed.");
    } catch (error) {
      const code = error instanceof CookingVideoError ? error.code : "QUALITY_GATE_FAILED";
      const current = await store.load(options.jobId);
      if (current.state.status !== "failed") {
        await store.transition(options.jobId, "failed", {
          errorCode: code,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
    return;
  }
  if (options.command === "run" || options.command === "resume") {
    if (!options.jobId) throw new CookingVideoError("JOB_INVALID", "--job is required.");
    const interrupt = new AbortController();
    const onInterrupt = () => interrupt.abort(new Error("Interrupted by SIGINT."));
    process.once("SIGINT", onInterrupt);
    const signal = options.timeoutMs === undefined
      ? interrupt.signal
      : AbortSignal.any([interrupt.signal, AbortSignal.timeout(options.timeoutMs)]);
    const result = await runJobPipeline(store, options.jobId, {
      referenceCameraId: options.referenceCameraId,
      manualOffsets: Object.keys(options.manualOffsets).length === 0 ? undefined : options.manualOffsets,
      template: options.template,
      approved: options.approved,
      draft: options.draft,
      signal,
    });
    process.removeListener("SIGINT", onInterrupt);
    process.stdout.write(`${JSON.stringify({ jobId: options.jobId, status: result.state.status, stoppedForApproval: result.stoppedForApproval }, null, 2)}\n`);
    return;
  }
  throw new CookingVideoError("JOB_INVALID", `${usage()}\n\nUnknown or missing command.`);
}

const invokedAsScript = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  runCookingVideo().catch(error => {
    const payload = error instanceof CookingVideoError
      ? { error: error.code, message: error.message, details: error.details }
      : { error: "UNEXPECTED", message: error instanceof Error ? error.message : String(error) };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node

import { chmod, cp, lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const releaseRoot = path.join(repoRoot, "release");
const desktopRoot = path.join(repoRoot, "packages", "desktop");
const tauriRoot = path.join(desktopRoot, "src-tauri");
const runtimeRoot = path.join(tauriRoot, "resources", "runtime");
const stagingRoot = path.join(repoRoot, ".tmp", "loong-desktop-runtime");
const cliDeployRoot = path.join(stagingRoot, "cli-deploy");
const smokeDataRoot = path.join(stagingRoot, "smoke-data");
const runtimeManifestPath = path.join(runtimeRoot, "manifest.json");

const BUNDLED_CLI_ENTRY_RELATIVE = path.join("cli", "dist", "index.js");
const BUNDLED_NODE_RELATIVE =
  process.platform === "win32"
    ? path.join("node", "node.exe")
    : path.join("node", "bin", "node");

const corepackCommand = process.platform === "win32" ? "corepack.cmd" : "corepack";

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "inspect":
      await inspectPackagingState();
      return;
    case "prepare-runtime":
      await prepareBundledRuntime();
      return;
    case "build":
      await buildDesktopPackage(options.profile);
      return;
    case "publish":
      await publishReleaseFromTauriBuild();
      return;
    default:
      throw new Error(
        `Unknown command "${command}". Expected inspect, prepare-runtime, build, or publish.`,
      );
  }
}

function parseArgs(argv) {
  const command = argv[0] ?? "inspect";
  const options = {
    profile: "build",
  };

  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--profile") {
      const profile = argv[index + 1];
      if (!profile) {
        throw new Error("Missing value for --profile.");
      }
      if (profile !== "build" && profile !== "release") {
        throw new Error(`Unsupported profile "${profile}". Use build or release.`);
      }
      options.profile = profile;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument "${token}".`);
  }

  return { command, options };
}

async function inspectPackagingState() {
  const tauriConfig = await readJson(path.join(tauriRoot, "tauri.conf.json"));
  const tauriBundleConfig = await readOptionalJson(path.join(tauriRoot, "tauri.bundle.conf.json"));
  const runtimeManifest = await readOptionalJson(runtimeManifestPath);
  const runtimePresent = await pathExists(runtimeRoot);
  const bundledCliEntry = path.join(runtimeRoot, BUNDLED_CLI_ENTRY_RELATIVE);
  const bundledNodeBinary = path.join(runtimeRoot, BUNDLED_NODE_RELATIVE);
  const version = tauriConfig.version;
  const tauriArtifactPath = resolveTauriInstallerPath(version);
  const releaseArtifactPath = resolveReleaseInstallerPath(version);

  const lines = [
    `Repo root: ${repoRoot}`,
    `Release output root: ${releaseRoot}`,
    `Desktop root: ${desktopRoot}`,
    `Tauri root: ${tauriRoot}`,
    `Host platform: ${process.platform} ${os.release()} (${os.arch()})`,
    `Packaging node source: ${process.execPath}`,
    `Runtime root: ${runtimeRoot}`,
    `Runtime prepared: ${runtimePresent ? "yes" : "no"}`,
    `Bundled node target: ${bundledNodeBinary}`,
    `Bundled CLI entry: ${bundledCliEntry}`,
    `Base Tauri bundle resources: ${formatBundleResources(tauriConfig.bundle?.resources)}`,
    `Release bundle resources: ${formatBundleResources(tauriBundleConfig?.bundle?.resources)}`,
    `Tauri installer build path: ${tauriArtifactPath}`,
    `Release installer output path: ${releaseArtifactPath}`,
  ];

  if (runtimeManifest) {
    lines.push(`Runtime manifest generated: ${runtimeManifest.generatedAt}`);
    lines.push(`Bundled node version: ${runtimeManifest.node?.version ?? "unknown"}`);
    lines.push(`Bundled CLI runtime size: ${formatBytes(runtimeManifest.cli?.sizeBytes ?? 0)}`);
    lines.push(`Bundled runtime size: ${formatBytes(runtimeManifest.runtime?.sizeBytes ?? 0)}`);
  }

  await appendInstallerStatus(lines, tauriArtifactPath, "Tauri installer");
  await appendInstallerStatus(lines, releaseArtifactPath, "Release installer");

  process.stdout.write(`${lines.join("\n")}\n`);
}

async function buildDesktopPackage(profile) {
  await prepareBundledRuntime();

  const tauriArgs =
    profile === "release"
      ? ["pnpm", "exec", "tauri", "build", "-b", "nsis", "-c", "src-tauri/tauri.bundle.conf.json"]
      : ["pnpm", "exec", "tauri", "build"];

  await runCommand(corepackCommand, tauriArgs, { cwd: desktopRoot });

  const tauriConfig = await readJson(path.join(tauriRoot, "tauri.conf.json"));
  const version = tauriConfig.version;
  const tauriArtifactPath = resolveTauriInstallerPath(version);
  if (profile === "release" && !(await pathExists(tauriArtifactPath))) {
    throw new Error(`Expected installer artifact was not generated: ${tauriArtifactPath}`);
  }

  if (profile === "release") {
    const published = await publishReleaseArtifacts(version);
    process.stdout.write(`Published release artifacts to ${releaseRoot}\n`);
    process.stdout.write(`  installer: ${published.installerPath} (${formatBytes(published.installerSizeBytes)})\n`);
  }
}

async function prepareBundledRuntime() {
  await rm(stagingRoot, { recursive: true, force: true });
  await rm(runtimeRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });

  await runCommand(corepackCommand, ["pnpm", "--filter", "@loong/cli...", "build"], { cwd: repoRoot });
  await runCommand(
    corepackCommand,
    ["pnpm", "--filter", "@loong/cli", "deploy", "--prod", "--legacy", cliDeployRoot],
    { cwd: repoRoot },
  );

  const bundledCliRoot = path.join(runtimeRoot, "cli");
  await mkdir(runtimeRoot, { recursive: true });
  await assembleBundledCliRuntime(cliDeployRoot, bundledCliRoot);

  const bundledNodeBinary = await copyBundledNodeRuntime(runtimeRoot);
  const bundledCliEntry = path.join(bundledCliRoot, "dist", "index.js");
  await smokeTestBundledRuntime(bundledNodeBinary, bundledCliEntry);
  await writeRuntimeManifest(bundledNodeBinary, bundledCliRoot);
  await rm(stagingRoot, { recursive: true, force: true });

  process.stdout.write(`Prepared bundled runtime at ${runtimeRoot}\n`);
}

async function assembleBundledCliRuntime(sourceRoot, bundledCliRoot) {
  const requiredWorkspacePackages = await collectWorkspacePackageClosure("@loong/cli");
  requiredWorkspacePackages.delete("@loong/cli");

  await rm(bundledCliRoot, { recursive: true, force: true });
  await mkdir(bundledCliRoot, { recursive: true });
  await cp(path.join(sourceRoot, "dist"), path.join(bundledCliRoot, "dist"), {
    recursive: true,
    force: true,
  });
  await cp(path.join(sourceRoot, "package.json"), path.join(bundledCliRoot, "package.json"), {
    force: true,
  });

  const bundledNodeModules = path.join(bundledCliRoot, "node_modules");
  await mkdir(bundledNodeModules, { recursive: true });
  await copyHoistedNodeModules(
    path.join(sourceRoot, "node_modules", ".pnpm", "node_modules"),
    bundledNodeModules,
    requiredWorkspacePackages,
  );

  await removeFilesMatching(path.join(bundledCliRoot, "dist"), filePath => {
    return (
      filePath.endsWith(".d.ts") ||
      filePath.endsWith(".d.ts.map") ||
      filePath.endsWith(".js.map")
    );
  });
}

async function copyHoistedNodeModules(
  sourceNodeModules,
  destinationNodeModules,
  requiredWorkspacePackages,
) {
  const entries = await readdir(sourceNodeModules, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".bin") {
      continue;
    }

    if (
      path.basename(sourceNodeModules) === "@loong" &&
      !requiredWorkspacePackages.has(`@loong/${entry.name}`)
    ) {
      continue;
    }

    const sourcePath = path.join(sourceNodeModules, entry.name);
    const destinationPath = path.join(destinationNodeModules, entry.name);

    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await mkdir(destinationPath, { recursive: true });
      await copyHoistedNodeModules(
        sourcePath,
        destinationPath,
        requiredWorkspacePackages,
      );
      continue;
    }

    await cp(sourcePath, destinationPath, {
      recursive: true,
      force: true,
      dereference: true,
      verbatimSymlinks: false,
    });
  }
}

async function collectWorkspacePackageClosure(entryPackageName) {
  const packagesRoot = path.join(repoRoot, "packages");
  const packageEntries = await readdir(packagesRoot, { withFileTypes: true });
  const dependencyGraph = new Map();

  for (const entry of packageEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = path.join(packagesRoot, entry.name, "package.json");
    if (!(await pathExists(packageJsonPath))) {
      continue;
    }

    const packageJson = await readJson(packageJsonPath);
    const dependencyNames = Object.keys(packageJson.dependencies ?? {}).filter(name =>
      name.startsWith("@loong/"),
    );
    dependencyGraph.set(packageJson.name, dependencyNames);
  }

  const required = new Set();
  const queue = [entryPackageName];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || required.has(current)) {
      continue;
    }
    required.add(current);
    for (const dependency of dependencyGraph.get(current) ?? []) {
      queue.push(dependency);
    }
  }

  return required;
}

async function removeFilesMatching(rootPath, predicate) {
  if (!(await pathExists(rootPath))) {
    return;
  }
  const entries = await readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      await removeFilesMatching(entryPath, predicate);
      continue;
    }
    if (entry.isFile() && predicate(entryPath)) {
      await rm(entryPath, { force: true });
    }
  }
}

async function copyBundledNodeRuntime(runtimeRootPath) {
  const targetPath = path.join(runtimeRootPath, BUNDLED_NODE_RELATIVE);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(process.execPath, targetPath, { force: true });
  if (process.platform !== "win32") {
    await chmod(targetPath, 0o755);
  }
  return targetPath;
}

async function smokeTestBundledRuntime(bundledNodeBinary, bundledCliEntry) {
  await rm(smokeDataRoot, { recursive: true, force: true });
  await mkdir(smokeDataRoot, { recursive: true });
  await runCommand(bundledNodeBinary, [bundledCliEntry, "help"], {
    cwd: path.dirname(bundledCliEntry),
    env: {
      ...process.env,
      LOONG_DATA_ROOT: smokeDataRoot,
      LOONG_GATEWAY_PORT: "17359",
    },
  });
  await rm(smokeDataRoot, { recursive: true, force: true });
}

async function writeRuntimeManifest(bundledNodeBinary, bundledCliRoot) {
  const runtimeSize = await calculatePathSize(runtimeRoot);
  const nodeStat = await stat(bundledNodeBinary);
  const cliSize = await calculatePathSize(bundledCliRoot);

  const manifest = {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: {
      version: process.version,
      sourcePath: process.execPath,
      bundledPath: path.relative(runtimeRoot, bundledNodeBinary).split(path.sep).join("/"),
      sizeBytes: nodeStat.size,
    },
    cli: {
      entry: BUNDLED_CLI_ENTRY_RELATIVE.split(path.sep).join("/"),
      rootPath: "cli",
      sizeBytes: cliSize,
    },
    runtime: {
      sizeBytes: runtimeSize,
    },
  };

  await writeFile(runtimeManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function calculatePathSize(targetPath) {
  const entry = await lstat(targetPath);
  if (entry.isFile()) {
    return entry.size;
  }
  if (!entry.isDirectory()) {
    return 0;
  }

  let total = 0;
  const children = await readdir(targetPath, { withFileTypes: true });
  for (const child of children) {
    total += await calculatePathSize(path.join(targetPath, child.name));
  }
  return total;
}

function resolveInstallerFileName(version) {
  return `Loong_${version}_x64-setup.exe`;
}

function resolveTauriInstallerPath(version) {
  return path.join(tauriRoot, "target", "release", "bundle", "nsis", resolveInstallerFileName(version));
}

function resolveReleaseInstallerPath(version) {
  return path.join(releaseRoot, resolveInstallerFileName(version));
}

function resolveTauriDesktopExePath() {
  return path.join(tauriRoot, "target", "release", "loong-desktop.exe");
}

function resolveReleaseDesktopExePath() {
  return path.join(releaseRoot, "loong-desktop.exe");
}

async function appendInstallerStatus(lines, artifactPath, label) {
  if (await pathExists(artifactPath)) {
    const artifactStat = await stat(artifactPath);
    lines.push(`${label} exists: yes (${formatBytes(artifactStat.size)})`);
  } else {
    lines.push(`${label} exists: no`);
  }
}

async function publishReleaseFromTauriBuild() {
  const tauriConfig = await readJson(path.join(tauriRoot, "tauri.conf.json"));
  const version = tauriConfig.version;
  const tauriInstallerPath = resolveTauriInstallerPath(version);
  if (!(await pathExists(tauriInstallerPath))) {
    throw new Error(
      `Tauri installer not found. Run desktop:release first: ${tauriInstallerPath}`,
    );
  }
  const published = await publishReleaseArtifacts(version);
  process.stdout.write(`Published release artifacts to ${releaseRoot}\n`);
  process.stdout.write(
    `  installer: ${published.installerPath} (${formatBytes(published.installerSizeBytes)})\n`,
  );
  process.stdout.write(`  manifest: ${published.manifestPath}\n`);
}

async function publishReleaseArtifacts(version) {
  await mkdir(releaseRoot, { recursive: true });

  const tauriInstallerPath = resolveTauriInstallerPath(version);
  const releaseInstallerPath = resolveReleaseInstallerPath(version);
  await cp(tauriInstallerPath, releaseInstallerPath, { force: true });
  const installerStat = await stat(releaseInstallerPath);

  const tauriDesktopExePath = resolveTauriDesktopExePath();
  let desktopExeSizeBytes = 0;
  if (await pathExists(tauriDesktopExePath)) {
    const releaseDesktopExePath = resolveReleaseDesktopExePath();
    await cp(tauriDesktopExePath, releaseDesktopExePath, { force: true });
    desktopExeSizeBytes = (await stat(releaseDesktopExePath)).size;
  }

  const releaseManifestPath = path.join(releaseRoot, "manifest.json");
  const releaseManifest = {
    generatedAt: new Date().toISOString(),
    version,
    platform: process.platform,
    arch: process.arch,
    installer: {
      fileName: resolveInstallerFileName(version),
      path: releaseInstallerPath,
      sizeBytes: installerStat.size,
      tauriBuildPath: tauriInstallerPath,
    },
    desktopExecutable:
      desktopExeSizeBytes > 0
        ? {
            fileName: "loong-desktop.exe",
            path: resolveReleaseDesktopExePath(),
            sizeBytes: desktopExeSizeBytes,
            tauriBuildPath: tauriDesktopExePath,
          }
        : undefined,
  };

  await writeFile(releaseManifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`, "utf8");

  return {
    installerPath: releaseInstallerPath,
    installerSizeBytes: installerStat.size,
    manifestPath: releaseManifestPath,
  };
}

function formatBundleResources(resources) {
  if (!resources) {
    return "none";
  }
  return JSON.stringify(resources);
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function readOptionalJson(filePath) {
  if (!(await pathExists(filePath))) {
    return null;
  }
  return readJson(filePath);
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const cwd = options.cwd ?? repoRoot;
    const env = options.env ?? process.env;
    let child;

    if (process.platform === "win32" && command.endsWith(".cmd")) {
      child = spawn("cmd.exe", ["/d", "/s", "/c", command, ...args], {
        cwd,
        env,
        stdio: "inherit",
        shell: false,
      });
    } else {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: "inherit",
        shell: false,
      });
    }

    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`));
    });
  });
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

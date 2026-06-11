import { cp, mkdir, readFile, readdir, realpath, rm, symlink, stat } from "node:fs/promises";
import path from "node:path";
import { resolveLoongDataRoot } from "../loong-paths.js";

export interface InstalledPluginSummary {
  id: string;
  name: string;
  root: string;
  kind: "loong";
  linked: boolean;
}

export function defaultPluginsInstallDir(): string {
  return path.join(resolveLoongDataRoot(), "plugins");
}

export async function listInstalledPlugins(pluginsDir = defaultPluginsInstallDir()): Promise<InstalledPluginSummary[]> {
  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });
    const plugins: InstalledPluginSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const root = path.join(pluginsDir, entry.name);
      const summary = await describeInstalledPlugin(root);
      if (summary) {
        plugins.push(summary);
      }
    }
    return plugins.sort((left, right) => left.id.localeCompare(right.id));
  } catch {
    return [];
  }
}

export async function installPlugin(source: string, options: { link?: boolean } = {}): Promise<InstalledPluginSummary> {
  const pluginsDir = defaultPluginsInstallDir();
  await mkdir(pluginsDir, { recursive: true });
  const resolvedSource = await realpath(path.resolve(source));
  const sourceStat = await stat(resolvedSource);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Plugin source must be a directory: ${resolvedSource}`);
  }
  const summary = await describeInstalledPlugin(resolvedSource);
  if (!summary) {
    throw new Error(`Plugin source is missing loong.plugin.json: ${resolvedSource}`);
  }
  const target = path.join(pluginsDir, summary.id);
  await rm(target, { recursive: true, force: true });
  if (options.link) {
    await symlink(resolvedSource, target, process.platform === "win32" ? "junction" : "dir");
  } else {
    await cp(resolvedSource, target, { recursive: true, force: true });
  }
  const installed = await describeInstalledPlugin(target);
  if (!installed) {
    throw new Error(`Installed plugin is missing a valid manifest: ${target}`);
  }
  return installed;
}

async function describeInstalledPlugin(root: string): Promise<InstalledPluginSummary | undefined> {
  const resolved = await realpath(root);
  const linked = await isSymlink(root);
  try {
    const manifestPath = path.join(resolved, "loong.plugin.json");
    const manifestStat = await stat(manifestPath);
    if (!manifestStat.isFile()) {
      return undefined;
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: string };
    const id = typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim() : path.basename(resolved);
    return {
      id,
      name: id,
      root: resolved,
      kind: "loong",
      linked,
    };
  } catch {
    return undefined;
  }
}

async function isSymlink(value: string): Promise<boolean> {
  try {
    const entry = await stat(value);
    return entry.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function runPlugins(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    printPluginsHelp();
    return;
  }
  if (sub === "list") {
    const plugins = await listInstalledPlugins();
    if (!plugins.length) {
      process.stdout.write(`No plugins installed in ${defaultPluginsInstallDir()}.\n`);
      return;
    }
    for (const plugin of plugins) {
      const mode = plugin.linked ? "link" : "copy";
      process.stdout.write(`${plugin.id}\t${plugin.kind}\t${mode}\t${plugin.root}\n`);
    }
    return;
  }
  if (sub === "install") {
    let link = false;
    const sources: string[] = [];
    for (let index = 1; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === "-l" || arg === "--link") {
        link = true;
        continue;
      }
      if (arg) {
        sources.push(arg);
      }
    }
    if (!sources.length) {
      throw new Error("Usage: loong plugins install [-l|--link] <plugin-path>");
    }
    for (const source of sources) {
      const installed = await installPlugin(source, { link });
      process.stdout.write(`Installed ${installed.id} (${installed.kind}) -> ${installed.root}\n`);
    }
    return;
  }
  throw new Error(`Unknown plugins subcommand: ${sub}`);
}

function printPluginsHelp(): void {
  process.stdout.write(`Loong plugins

Usage:
  loong plugins list
  loong plugins install [-l|--link] <plugin-path>

Installed plugins are loaded from ${defaultPluginsInstallDir()} by loong gateway.
`);
}

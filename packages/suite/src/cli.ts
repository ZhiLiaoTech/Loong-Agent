#!/usr/bin/env node
import { installSuite, listInstalledSuites } from "./index.js";

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;

  if (sub === "install") {
    const dir = rest.find((arg) => !arg.startsWith("--"));
    if (!dir) {
      console.error("usage: loong-suite install <dir> [--data-root <path>]");
      process.exitCode = 1;
      return;
    }
    const dataRoot = flagValue(rest, "--data-root");
    const result = await installSuite(dir, dataRoot ? { dataRoot } : {});
    console.log(`installed suite "${result.manifest.id}" v${result.manifest.version}`);
    console.log(`  workspace:      ${result.workspaceDir}`);
    console.log(`  agent profile:  ${result.profileId}`);
    console.log(
      `  skills copied:  ${result.skillsCopied.length}` +
        (result.skillsMissing.length ? ` (missing: ${result.skillsMissing.length})` : ""),
    );
    console.log(
      `  crons imported: ${result.cronsImported}` +
        (result.cronJobsFile ? ` -> ${result.cronJobsFile}` : ""),
    );
    if (result.toolPolicyFile) {
      console.log(`  tool policy:    ${result.toolPolicyFile}`);
    }
    if (result.manifest.uiConfigPath) {
      console.log(`  ui.json kept (not rendered): ${result.manifest.uiConfigPath}`);
    }
    return;
  }

  if (sub === "list") {
    const suites = await listInstalledSuites(flagValue(rest, "--data-root"));
    if (suites.length === 0) {
      console.log("no suites installed");
      return;
    }
    for (const suite of suites) {
      console.log(`${suite.id}\tv${suite.version}\t${suite.workspace}`);
    }
    return;
  }

  console.error("usage: loong-suite <install|list> [...]");
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

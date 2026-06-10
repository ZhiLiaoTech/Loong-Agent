import {
  installSuite,
  installSuiteFromUrl,
  installSuiteFromZipFile,
  listInstalledSuites,
  type InstallAndRegisterResult,
} from "@loong/suite";

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

export async function runSuite(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  if (sub === "install") {
    const target = rest.find(arg => !arg.startsWith("--"));
    if (!target) {
      throw new Error(
        "Usage: loong suite install <dir|file.zip|url> [--data-root <path>] [--token <t>] [--file-size <n>]",
      );
    }
    const dataRoot = flagValue(rest, "--data-root");
    const baseOptions = dataRoot !== undefined ? { dataRoot } : {};

    let result: InstallAndRegisterResult;
    if (/^https?:\/\//i.test(target)) {
      const token = flagValue(rest, "--token");
      const fileSizeRaw = flagValue(rest, "--file-size");
      const fileSize = fileSizeRaw !== undefined ? Number(fileSizeRaw) : undefined;
      result = await installSuiteFromUrl(target, {
        ...baseOptions,
        ...(token !== undefined ? { token } : {}),
        ...(fileSize !== undefined && Number.isFinite(fileSize) ? { fileSize } : {}),
      });
    } else if (target.endsWith(".zip")) {
      result = await installSuiteFromZipFile(target, baseOptions);
    } else {
      result = await installSuite(target, baseOptions);
    }

    process.stdout.write(`Installed suite "${result.manifest.id}" v${result.manifest.version}\n`);
    process.stdout.write(`  agent profile:  ${result.profileId}\n`);
    process.stdout.write(`  skills copied:  ${result.skillsCopied.length}\n`);
    process.stdout.write(`  crons imported: ${result.cronsImported}\n`);
    if (result.orgEmployeeId) {
      process.stdout.write(`  org employee:   ${result.orgEmployeeId}\n`);
    }
    if (result.toolPolicyFile) {
      process.stdout.write(`  tool policy:    ${result.toolPolicyFile}\n`);
    }
    return;
  }

  if (sub === "list") {
    const suites = await listInstalledSuites(flagValue(rest, "--data-root"));
    if (suites.length === 0) {
      process.stdout.write("No suites installed.\n");
      return;
    }
    for (const suite of suites) {
      process.stdout.write(`${suite.id}\tv${suite.version}\t${suite.workspace}\n`);
    }
    return;
  }

  throw new Error("Usage: loong suite <install <dir|zip|url> | list> [...]");
}

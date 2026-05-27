import type { TestCase } from "../runner.js";
import { cliTestCases } from "./cli.tests.js";
import { gatewayTestCases } from "./gateway.tests.js";
import { runtimeTestCases } from "./runtime.tests.js";

/** Core / misc tests registered in index.ts */
export type CoreTestCases = TestCase[];

export function mergeAllTestCases(core: CoreTestCases): TestCase[] {
  return [
    ...core,
    ...cliTestCases,
    ...runtimeTestCases,
    ...gatewayTestCases,
  ];
}

import type { TestCase } from "../runner.js";
import { cliTestCases } from "./cli.tests.js";
import { gatewayTestCases } from "./gateway.tests.js";
import { runtimeTestCases } from "./runtime.tests.js";
import { suiteTestCases } from "./suite.tests.js";
import { toolsTestCases } from "./tools.tests.js";

/** Core / misc tests registered in index.ts */
export type CoreTestCases = TestCase[];

import { studioTestCases } from "./studio.tests.js";

export function mergeAllTestCases(core: CoreTestCases): TestCase[] {
  return [
    ...core,
    ...cliTestCases,
    ...runtimeTestCases,
    ...suiteTestCases,
    ...gatewayTestCases,
    ...studioTestCases,
    ...toolsTestCases,
  ];
}

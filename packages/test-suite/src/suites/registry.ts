import type { TestCase } from "../runner.js";
import { cliTestCases } from "./cli.tests.js";
import { gatewayTestCases } from "./gateway.tests.js";
import { memoryV2TestCases } from "./memory-v2.tests.js";
import { obligationTestCases } from "./obligation.tests.js";
import { obligationVerdictTestCases } from "./obligation-verdict.tests.js";
import { obligationSedimentExplainTestCases } from "./obligation-sediment-explain.tests.js";
import { obligationStepFlowTestCases } from "./obligation-step-flow.tests.js";
import { ontologyConsolidationTestCases } from "./ontology-consolidation.tests.js";
import { ontologyControlTestCases } from "./ontology-control.tests.js";
import { ontologyRecallTestCases } from "./ontology-recall.tests.js";
import { ontologyTestCases } from "./ontology.tests.js";
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
    ...memoryV2TestCases,
    ...ontologyTestCases,
    ...ontologyConsolidationTestCases,
    ...ontologyRecallTestCases,
    ...ontologyControlTestCases,
    ...obligationTestCases,
    ...obligationVerdictTestCases,
  ...obligationSedimentExplainTestCases,
  ...obligationStepFlowTestCases,
  ];
}

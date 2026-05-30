import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const indexPath = path.join(srcDir, "index.ts");
const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);

const parseBlock = lines.slice(1940, 2852);
const helpers = lines.slice(3160, 3192);
const typesBlock = lines.slice(390, 435);

const typesFile = `import type { GatewayAgentParams } from "./gateway-agent-types.js";
import type { GatewayAgentConfigSaveParams } from "./gateway-agent-types.js";

${typesBlock.join("\n")}
`;

const paramsOut = `import type { LoongCronJob } from "@loong/cron";
import type { LoongThinkingLevel } from "@loong/core";
import type {
  ApprovalStatus,
  EmployeeRegistry,
  OrgTicket,
  ToolPolicyDocument,
} from "@loong/org";
import type { GatewayTierName } from "./gateway-agent-types.js";

${lines.slice(207, 389).join("\n")}
`;

const imports = `import { parseCronSchedule } from "@loong/cron";
import type { ApprovalStatus, EmployeeRegistry, OrgTicket, ToolPolicyDocument } from "@loong/org";
import { parseGatewayAgentParams } from "./agent-params.js";
import { parseAgentConfigSaveParams } from "./gateway-agent-config.js";
import { badRequest } from "./gateway-http.js";
import {
  isLoongThinking,
  isRecord,
  normalizeBoundedText,
  normalizeShortText,
} from "./gateway-parse.js";
import type {
  GatewayApprovalListParams,
  GatewayApprovalResolveParams,
  GatewayCronJobRemoveParams,
  GatewayCronJobUpsertParams,
  GatewayEmployeeSaveParams,
  GatewayKpiSnapshotParams,
  GatewayMemoryCandidateListParams,
  GatewayMemoryCandidatePromoteParams,
  GatewayMemoryCandidateRejectParams,
  GatewayModelConfigSaveParams,
  GatewayModelProviderConfig,
  GatewayModelProviderType,
  GatewayTierClassifyParams,
  GatewayTierConfigSaveParams,
  GatewayTierKeywordHint,
  GatewayTierSpec,
  GatewayToolInvokeParams,
  GatewayTrajectoryGetParams,
  GatewayTrajectoryListParams,
} from "./gateway-rpc-params.js";
import type { GatewayRequest } from "./gateway-rpc-types.js";

`;

const body = [...parseBlock, "", ...helpers]
  .map(line => {
    if (line.startsWith("function parseGatewayRequest")) {
      return line.replace("function parseGatewayRequest", "export function parseGatewayRequest");
    }
    return line;
  })
  .join("\n");

fs.writeFileSync(path.join(srcDir, "gateway-rpc-types.ts"), typesFile);
fs.writeFileSync(path.join(srcDir, "gateway-rpc-params.ts"), paramsOut);
fs.writeFileSync(path.join(srcDir, "gateway-rpc-parse.ts"), imports + body);
console.log("extracted", parseBlock.length, "parse lines");

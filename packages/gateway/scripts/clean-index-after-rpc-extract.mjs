import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const indexPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.ts");
let lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);

// Remove GatewayRequest/Response block (lines 391-439 in original 1-based)
lines.splice(390, 49);

// Remove parse block (was 1941-2852, shift by -49 => 1892-2803)
lines.splice(1891, 912);

// Remove parse helpers (was 3161-3192, shift by -49-912 => 2200-2231)
lines.splice(2199, 33);

const importInsert = `import { parseGatewayRequest } from "./gateway-rpc-parse.js";
`;
const typeReexport = `export type { GatewayRequest, GatewayResponse } from "./gateway-rpc-types.js";
export type {
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
`;

// Insert after gateway-tools import block
const toolsImportIdx = lines.findIndex(line => line.includes('from "./gateway-tools.js"'));
if (toolsImportIdx >= 0) {
  lines.splice(toolsImportIdx + 1, 0, importInsert.trimEnd());
}

// Insert re-exports after GatewayConfig re-export
const configExportIdx = lines.findIndex(line => line.includes('export type { GatewayConfig }'));
if (configExportIdx >= 0) {
  lines.splice(configExportIdx + 1, 0, ...typeReexport.trimEnd().split("\n"));
}

fs.writeFileSync(indexPath, `${lines.join("\n")}\n`);
console.log("cleaned index.ts, lines:", lines.length);

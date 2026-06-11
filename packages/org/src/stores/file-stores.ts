import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DigitalEmployee,
  EmployeeRegistry,
  EmployeeStore,
  OrgApprovalChain,
  OrgDocument,
  OrgPosition,
  OrgReportingLine,
  OrgStore,
  OrgUnit,
  OrgToolDecision,
  ToolPolicyDefinition,
  ToolPolicyDocument,
  ToolPolicyRule,
  ToolPolicyStore,
} from "../types.js";

const EMPTY_ORG: OrgDocument = {
  version: 1,
  units: [],
  positions: [],
  reporting: [],
  approvalChains: [],
};

const EMPTY_EMPLOYEES: EmployeeRegistry = {
  employees: [],
};

const EMPTY_POLICIES: ToolPolicyDocument = {
  policies: [],
};

/**
 * Wraps a load function with an mtime-keyed cache. The org permission evaluator
 * calls load() once per tool invocation; without this an agent turn that fires
 * N tools re-reads + re-parses + re-normalizes the same JSON N times. We stat
 * the file (cheap, non-blocking) and reuse the prior normalized result while the
 * mtime is unchanged. A save() bumps the file mtime, so the next load() misses
 * the cache and reloads — no manual invalidation needed. Missing file is cached
 * under a sentinel so the fallback path is also memoized.
 */
function createMtimeCachedLoader<T>(filePath: string, load: () => Promise<T>): () => Promise<T> {
  let cached: { mtimeMs: number; value: T } | undefined;
  return async () => {
    let mtimeMs = -1;
    try {
      mtimeMs = (await stat(filePath)).mtimeMs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (cached !== undefined && cached.mtimeMs === mtimeMs) {
      return cached.value;
    }
    const value = await load();
    cached = { mtimeMs, value };
    return value;
  };
}

export function createFileOrgStore(filePath: string): OrgStore {
  return {
    load: createMtimeCachedLoader(filePath, async () => {
      const document = await readJsonFile(filePath, EMPTY_ORG);
      return normalizeOrgDocument(document, filePath);
    }),
  };
}

export function createFileEmployeeStore(filePath: string): EmployeeStore {
  return {
    load: createMtimeCachedLoader(filePath, async () => {
      const document = await readJsonFile(filePath, EMPTY_EMPLOYEES);
      return normalizeEmployeeRegistry(document, filePath);
    }),
    async save(registry) {
      const normalized = normalizeEmployeeRegistry(registry, filePath);
      await writeJsonAtomic(filePath, {
        employees: normalized.employees,
        ...(normalized.defaultEmployeeId ? { defaultEmployeeId: normalized.defaultEmployeeId } : {}),
      });
      return { ...normalized, configPath: filePath };
    },
  };
}

export function createFileToolPolicyStore(filePath: string): ToolPolicyStore {
  return {
    load: createMtimeCachedLoader(filePath, async () => {
      const document = await readJsonFile(filePath, EMPTY_POLICIES);
      return normalizeToolPolicyDocument(document, filePath);
    }),
    async save(document) {
      const normalized = normalizeToolPolicyDocument(document, filePath);
      await writeJsonAtomic(filePath, { policies: normalized.policies });
      return { ...normalized, configPath: filePath };
    },
  };
}

function normalizeOrgDocument(value: unknown, configPath: string): OrgDocument {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_ORG, configPath };
  }
  const raw = value as Record<string, unknown>;
  return {
    version: typeof raw.version === "number" ? raw.version : 1,
    units: normalizeUnits(raw.units),
    positions: normalizePositions(raw.positions),
    reporting: normalizeReporting(raw.reporting),
    approvalChains: normalizeApprovalChains(raw.approvalChains),
    employeeRouting: normalizeEmployeeRouting(raw.employeeRouting),
    configPath,
  };
}

function normalizeEmployeeRouting(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        return undefined;
      }
      const raw = entry as Record<string, unknown>;
      if (typeof raw.employeeId !== "string" || !raw.employeeId.trim()) {
        return undefined;
      }
      if (!raw.match || typeof raw.match !== "object") {
        return undefined;
      }
      const matchRaw = raw.match as Record<string, unknown>;
      const keywords = Array.isArray(matchRaw.keywords)
        ? matchRaw.keywords
            .filter((keyword): keyword is string => typeof keyword === "string" && Boolean(keyword.trim()))
            .map(keyword => keyword.trim())
        : [];
      if (!keywords.length && typeof matchRaw.profileId !== "string") {
        return undefined;
      }
      return {
        ...(typeof raw.id === "string" && raw.id.trim() ? { id: raw.id.trim() } : {}),
        employeeId: raw.employeeId.trim(),
        match: {
          ...(keywords.length ? { keywords } : {}),
          ...(typeof matchRaw.profileId === "string" && matchRaw.profileId.trim()
            ? { profileId: matchRaw.profileId.trim() }
            : {}),
        },
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
}

function normalizeEmployeeRegistry(value: unknown, configPath: string): EmployeeRegistry {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_EMPLOYEES, configPath };
  }
  const raw = value as Record<string, unknown>;
  const employees = Array.isArray(raw.employees)
    ? raw.employees.map((entry, index) => normalizeEmployee(entry, index)).filter(Boolean) as DigitalEmployee[]
    : [];
  assertUniqueIds(employees.map(employee => employee.id), "employee id");
  const defaultEmployeeId =
    typeof raw.defaultEmployeeId === "string" && raw.defaultEmployeeId.trim()
      ? raw.defaultEmployeeId.trim()
      : undefined;
  if (defaultEmployeeId && !employees.some(employee => employee.id === defaultEmployeeId)) {
    throw new Error(`Default employee "${defaultEmployeeId}" is not configured.`);
  }
  return {
    employees,
    ...(defaultEmployeeId ? { defaultEmployeeId } : {}),
    configPath,
  };
}

function normalizeToolPolicyDocument(value: unknown, configPath: string): ToolPolicyDocument {
  if (!value || typeof value !== "object") {
    return { ...EMPTY_POLICIES, configPath };
  }
  const raw = value as Record<string, unknown>;
  const policies = Array.isArray(raw.policies)
    ? raw.policies
        .map((entry, index) => normalizeToolPolicy(entry, index))
        .filter(Boolean) as ToolPolicyDefinition[]
    : [];
  assertUniqueIds(policies.map(policy => policy.id), "tool policy id");
  return { policies, configPath };
}

function normalizeEmployee(value: unknown, index: number): DigitalEmployee | undefined {
  if (!value || typeof value !== "object") {
    throw new Error(`Employee ${index + 1} must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  const id = readString(raw.id, `Employee ${index + 1} id`);
  const displayName = readString(raw.displayName, `Employee ${id} displayName`);
  const profileId = readString(raw.profileId, `Employee ${id} profileId`);
  const positionId = readString(raw.positionId, `Employee ${id} positionId`);
  const unitId = readString(raw.unitId, `Employee ${id} unitId`);
  const toolPolicyId = readString(raw.toolPolicyId, `Employee ${id} toolPolicyId`);
  const status = raw.status === "inactive" ? "inactive" : "active";
  const employee: DigitalEmployee = {
    id,
    displayName,
    profileId,
    positionId,
    unitId,
    status,
    toolPolicyId,
  };
  if (typeof raw.managerId === "string" && raw.managerId.trim()) {
    employee.managerId = raw.managerId.trim();
  }
  if (typeof raw.approvalDelegateId === "string" && raw.approvalDelegateId.trim()) {
    employee.approvalDelegateId = raw.approvalDelegateId.trim();
  }
  if (typeof raw.kpiTemplateId === "string" && raw.kpiTemplateId.trim()) {
    employee.kpiTemplateId = raw.kpiTemplateId.trim();
  }
  if (raw.budget && typeof raw.budget === "object") {
    const budget = raw.budget as Record<string, unknown>;
    employee.budget = {
      ...(budget.tierDefault === "fast" || budget.tierDefault === "standard" || budget.tierDefault === "deep"
        ? { tierDefault: budget.tierDefault }
        : {}),
      ...(typeof budget.maxRunsPerDay === "number" ? { maxRunsPerDay: budget.maxRunsPerDay } : {}),
      ...(typeof budget.maxDelegationDepth === "number"
        ? { maxDelegationDepth: budget.maxDelegationDepth }
        : {}),
    };
  }
  return employee;
}

function normalizeToolPolicy(value: unknown, index: number): ToolPolicyDefinition | undefined {
  if (!value || typeof value !== "object") {
    throw new Error(`Tool policy ${index + 1} must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  const id = readString(raw.id, `Tool policy ${index + 1} id`);
  const rules = Array.isArray(raw.rules) ? raw.rules : [];
  return {
    id,
    ...(typeof raw.description === "string" ? { description: raw.description.trim() } : {}),
    rules: rules.map((rule, ruleIndex) => normalizeToolPolicyRule(rule, id, ruleIndex)),
  };
}

function normalizeToolPolicyRule(value: unknown, policyId: string, index: number): ToolPolicyRule {
  if (!value || typeof value !== "object") {
    throw new Error(`Tool policy ${policyId} rule ${index + 1} must be an object.`);
  }
  const raw = value as Record<string, unknown>;
  if (!raw.match || typeof raw.match !== "object") {
    throw new Error(`Tool policy ${policyId} rule ${index + 1} requires match.`);
  }
  const matchRaw = raw.match as Record<string, unknown>;
  const decision = raw.decision;
  if (decision !== "allow" && decision !== "deny" && decision !== "ask" && decision !== "approval") {
    throw new Error(`Tool policy ${policyId} rule ${index + 1} decision is invalid.`);
  }
  const resolvedDecision = decision as OrgToolDecision;
  return {
    ...(typeof raw.id === "string" && raw.id.trim() ? { id: raw.id.trim() } : {}),
    match: {
      ...(typeof matchRaw.toolName === "string" ? { toolName: matchRaw.toolName.trim() } : {}),
      ...(typeof matchRaw.capability === "string" ? { capability: matchRaw.capability.trim() } : {}),
      ...(typeof matchRaw.inputPathContains === "string"
        ? { inputPathContains: matchRaw.inputPathContains.trim() }
        : {}),
    },
    ...(raw.risk === "low" || raw.risk === "medium" || raw.risk === "high" || raw.risk === "critical"
      ? { risk: raw.risk }
      : {}),
    decision: resolvedDecision,
    ...(typeof raw.chainId === "string" && raw.chainId.trim() ? { chainId: raw.chainId.trim() } : {}),
    ...(typeof raw.reason === "string" ? { reason: raw.reason.trim() } : {}),
  };
}

function normalizeUnits(value: unknown): OrgUnit[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Org unit ${index + 1} must be an object.`);
    }
    const raw = entry as Record<string, unknown>;
    const id = readString(raw.id, `Org unit ${index + 1} id`);
    const name = readString(raw.name, `Org unit ${id} name`);
    return {
      id,
      name,
      ...(typeof raw.parentId === "string" && raw.parentId.trim() ? { parentId: raw.parentId.trim() } : {}),
    };
  });
}

function normalizePositions(value: unknown): OrgPosition[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Org position ${index + 1} must be an object.`);
    }
    const raw = entry as Record<string, unknown>;
    const id = readString(raw.id, `Org position ${index + 1} id`);
    const name = readString(raw.name, `Org position ${id} name`);
    const unitId = readString(raw.unitId, `Org position ${id} unitId`);
    return {
      id,
      name,
      unitId,
      ...(typeof raw.level === "string" && raw.level.trim() ? { level: raw.level.trim() } : {}),
    };
  });
}

function normalizeReporting(value: unknown): OrgReportingLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Reporting line ${index + 1} must be an object.`);
    }
    const raw = entry as Record<string, unknown>;
    return {
      employeeId: readString(raw.employeeId, `Reporting ${index + 1} employeeId`),
      managerId: readString(raw.managerId, `Reporting ${index + 1} managerId`),
    };
  });
}

function normalizeApprovalChains(value: unknown): OrgApprovalChain[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Approval chain ${index + 1} must be an object.`);
    }
    const raw = entry as Record<string, unknown>;
    const id = readString(raw.id, `Approval chain ${index + 1} id`);
    const name = readString(raw.name, `Approval chain ${id} name`);
    const steps = Array.isArray(raw.steps) ? raw.steps : [];
    return {
      id,
      name,
      steps: steps.map((step, stepIndex) => {
        if (!step || typeof step !== "object") {
          throw new Error(`Approval chain ${id} step ${stepIndex + 1} must be an object.`);
        }
        const stepRaw = step as Record<string, unknown>;
        return {
          ...(typeof stepRaw.approverRole === "string" ? { approverRole: stepRaw.approverRole.trim() } : {}),
          ...(typeof stepRaw.approverEmployeeId === "string"
            ? { approverEmployeeId: stepRaw.approverEmployeeId.trim() }
            : {}),
          ...(stepRaw.scope === "same-unit" || stepRaw.scope === "org" || stepRaw.scope === "manager"
            ? { scope: stepRaw.scope }
            : {}),
          ...(stepRaw.optional === true ? { optional: true } : {}),
        };
      }),
    };
  });
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertUniqueIds(ids: string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`Duplicate ${label}: ${id}`);
    }
    seen.add(id);
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

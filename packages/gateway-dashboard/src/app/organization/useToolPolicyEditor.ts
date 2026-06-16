import { useCallback, useRef, useState } from "react";
import { GatewayApiError } from "../../api/index.js";
import type { GatewayClient } from "../../api/index.js";
import type { OrgPolicyOption } from "./types.js";

export interface RawToolPolicy {
  id: string;
  description?: string;
  rules?: unknown[];
}

export interface ToolPolicyEditorMessages {
  reloaded: string;
  saved: string;
  invalidJson: string;
  syntaxError: string;
  discardConfirm: string;
  missingAssignedPolicy: string;
}

export const DEFAULT_TOOL_POLICY_EDITOR_MESSAGES: ToolPolicyEditorMessages = {
  reloaded: "策略 JSON 已重新加载。",
  saved: "工具策略已保存。",
  invalidJson: "JSON 必须包含 policies 数组。",
  syntaxError: "JSON 格式无效，请检查语法。",
  discardConfirm: "工具策略有未保存的修改，放弃并继续？",
  missingAssignedPolicy: "当前员工绑定的权限方案已不存在，请在「组织身份」中重新选择。",
};

function formatPolicyJson(policies: RawToolPolicy[]): string {
  return JSON.stringify({ policies }, null, 2);
}

export function mapToolPolicyOptions(rawPolicies: RawToolPolicy[]): OrgPolicyOption[] {
  return rawPolicies.map(policy => ({
    id: policy.id,
    ...(policy.description ? { description: policy.description } : {}),
    ruleCount: policy.rules?.length ?? 0,
  }));
}

function parsePolicyDocument(text: string, messages: ToolPolicyEditorMessages): RawToolPolicy[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (caught) {
    if (caught instanceof SyntaxError) {
      throw new Error(messages.syntaxError);
    }
    throw caught;
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { policies?: unknown }).policies)) {
    throw new Error(messages.invalidJson);
  }
  return (parsed as { policies: RawToolPolicy[] }).policies;
}

export function useToolPolicyEditor(
  client: GatewayClient,
  options: {
    messages?: Partial<ToolPolicyEditorMessages>;
    onStatus?: (status: string | null) => void;
    onError?: (error: string | null) => void;
  } = {},
) {
  const { messages: messageOverrides, onStatus, onError } = options;
  const messages = { ...DEFAULT_TOOL_POLICY_EDITOR_MESSAGES, ...messageOverrides };
  const [policyJsonText, setPolicyJsonTextState] = useState('{\n  "policies": []\n}');
  const [policyJsonBaseline, setPolicyJsonBaseline] = useState('{\n  "policies": []\n}');
  const [policies, setPolicies] = useState<readonly OrgPolicyOption[]>([]);
  const [savingPolicies, setSavingPolicies] = useState(false);
  const policyJsonTextRef = useRef(policyJsonText);
  const policyJsonBaselineRef = useRef(policyJsonBaseline);
  policyJsonTextRef.current = policyJsonText;
  policyJsonBaselineRef.current = policyJsonBaseline;

  const policyDirty = policyJsonText !== policyJsonBaseline;

  const setPolicyJsonText = useCallback((value: string) => {
    setPolicyJsonTextState(value);
  }, []);

  const applyPoliciesFromServer = useCallback((rawPolicies: RawToolPolicy[]) => {
    const text = formatPolicyJson(rawPolicies);
    setPolicyJsonTextState(text);
    setPolicyJsonBaseline(text);
    setPolicies(mapToolPolicyOptions(rawPolicies));
  }, []);

  const confirmDiscardIfDirty = useCallback((): boolean => {
    if (policyJsonTextRef.current === policyJsonBaselineRef.current) {
      return true;
    }
    return window.confirm(messages.discardConfirm);
  }, [messages.discardConfirm]);

  const reloadPolicies = useCallback(async () => {
    if (!confirmDiscardIfDirty()) {
      return;
    }
    onError?.(null);
    try {
      const payload = await client.rpc<{ policies: RawToolPolicy[] }>("policy.tool.get");
      applyPoliciesFromServer(payload.policies ?? []);
      onStatus?.(messages.reloaded);
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      onError?.(message);
    }
  }, [applyPoliciesFromServer, client, confirmDiscardIfDirty, messages.reloaded, onError, onStatus]);

  const savePolicies = useCallback(async (assignedPolicyId?: string): Promise<boolean> => {
    setSavingPolicies(true);
    try {
      onError?.(null);
      onStatus?.(null);
      const rawPolicies = parsePolicyDocument(policyJsonTextRef.current, messages);
      await client.rpc("policy.tool.save", { policies: rawPolicies });
      applyPoliciesFromServer(rawPolicies);
      const policyIds = rawPolicies.map(policy => policy.id);
      if (assignedPolicyId?.trim() && !policyIds.includes(assignedPolicyId.trim())) {
        onStatus?.(messages.missingAssignedPolicy);
      } else {
        onStatus?.(messages.saved);
      }
      return true;
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      onError?.(message);
      return false;
    } finally {
      setSavingPolicies(false);
    }
  }, [applyPoliciesFromServer, client, messages, onError, onStatus]);

  return {
    policyJsonText,
    policyDirty,
    policies,
    savingPolicies,
    setPolicyJsonText,
    applyPoliciesFromServer,
    confirmDiscardIfDirty,
    reloadPolicies,
    savePolicies,
  };
}

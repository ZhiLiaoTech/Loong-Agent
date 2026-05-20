import { useCallback, useEffect, useState } from "react";
import { GatewayApiError } from "../../api/errors.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import {
  EMPTY_TIER_CONFIG,
  type TierClassifyResult,
  type TierConfigState,
} from "./types.js";

export function useTiersPage() {
  const client = useGatewayClient();
  const [config, setConfig] = useState<TierConfigState>(EMPTY_TIER_CONFIG);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [classifyMessage, setClassifyMessage] = useState("");
  const [classifyResult, setClassifyResult] = useState<TierClassifyResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await client.rpc<TierConfigState>("tier.config.get");
      setConfig(normalizeIncoming(payload));
      setSupported(true);
    } catch (caught) {
      if (caught instanceof GatewayApiError && caught.message.includes("not available")) {
        setSupported(false);
        setConfig(EMPTY_TIER_CONFIG);
      } else {
        setError(caught instanceof GatewayApiError ? caught.message : String(caught));
      }
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const payload = await client.rpc<TierConfigState>("tier.config.save", buildSaveParams(config));
      setConfig(normalizeIncoming(payload));
      setStatus("分层配置已保存，将在下一轮对话生效。");
    } catch (caught) {
      setError(caught instanceof GatewayApiError ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }, [client, config]);

  const classify = useCallback(async () => {
    if (!classifyMessage.trim()) {
      setClassifyResult(null);
      return;
    }
    setError(null);
    try {
      const result = await client.rpc<TierClassifyResult>("tier.classify", {
        message: classifyMessage.trim(),
      });
      setClassifyResult(result);
    } catch (caught) {
      setError(caught instanceof GatewayApiError ? caught.message : String(caught));
    }
  }, [client, classifyMessage]);

  return {
    config,
    setConfig,
    status,
    error,
    loading,
    saving,
    supported,
    load,
    save,
    classifyMessage,
    setClassifyMessage,
    classifyResult,
    classify,
  };
}

function normalizeIncoming(payload: TierConfigState): TierConfigState {
  const out: TierConfigState = {
    enabled: Boolean(payload?.enabled),
    tiers: {
      ...(payload?.tiers?.fast ? { fast: { ...payload.tiers.fast } } : { fast: EMPTY_TIER_CONFIG.tiers.fast! }),
      ...(payload?.tiers?.standard ? { standard: { ...payload.tiers.standard } } : { standard: EMPTY_TIER_CONFIG.tiers.standard! }),
      ...(payload?.tiers?.deep ? { deep: { ...payload.tiers.deep } } : { deep: EMPTY_TIER_CONFIG.tiers.deep! }),
    },
    classifier: {
      mode: payload?.classifier?.mode === "fixed" ? "fixed" : "heuristic",
      ...(payload?.classifier?.fixedTier ? { fixedTier: payload.classifier.fixedTier } : {}),
      ...(payload?.classifier?.keywordHints ? { keywordHints: payload.classifier.keywordHints } : {}),
    },
  };
  if (payload?.appliesOn) out.appliesOn = payload.appliesOn;
  if (payload?.configPath) out.configPath = payload.configPath;
  return out;
}

function buildSaveParams(config: TierConfigState): TierConfigState {
  return {
    enabled: config.enabled,
    tiers: {
      ...(config.tiers.fast ? { fast: sanitizeSpec(config.tiers.fast) } : {}),
      ...(config.tiers.standard ? { standard: sanitizeSpec(config.tiers.standard) } : {}),
      ...(config.tiers.deep ? { deep: sanitizeSpec(config.tiers.deep) } : {}),
    },
    classifier: {
      mode: config.classifier.mode,
      ...(config.classifier.mode === "fixed" && config.classifier.fixedTier
        ? { fixedTier: config.classifier.fixedTier }
        : {}),
      ...(config.classifier.keywordHints && config.classifier.keywordHints.length > 0
        ? { keywordHints: config.classifier.keywordHints.map(h => ({ tier: h.tier, words: [...h.words] })) }
        : {}),
    },
  };
}

function sanitizeSpec(spec: TierConfigState["tiers"]["fast"]): NonNullable<TierConfigState["tiers"]["fast"]> {
  const out: NonNullable<TierConfigState["tiers"]["fast"]> = {};
  if (spec?.model?.trim()) out.model = spec.model.trim();
  if (spec?.modelFallbacks && spec.modelFallbacks.length > 0) {
    const fbs = spec.modelFallbacks.map(s => s.trim()).filter(Boolean);
    if (fbs.length > 0) out.modelFallbacks = fbs;
  }
  if (spec?.thinking) out.thinking = spec.thinking;
  if (typeof spec?.maxContextChars === "number" && spec.maxContextChars > 0) {
    out.maxContextChars = Math.floor(spec.maxContextChars);
  }
  if (typeof spec?.toolsEnabled === "boolean") out.toolsEnabled = spec.toolsEnabled;
  if (typeof spec?.memoryEnabled === "boolean") out.memoryEnabled = spec.memoryEnabled;
  if (spec?.systemPromptAddendum?.trim()) out.systemPromptAddendum = spec.systemPromptAddendum.trim();
  return out;
}

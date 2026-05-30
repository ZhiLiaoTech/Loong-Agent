import { useCallback, useEffect, useState } from "react";
import { GatewayApiError, type GatewayProviderSummary } from "../../api/index.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
import { useWorkbenchT } from "../i18n/WorkbenchI18nContext.js";
import { getStudioGatewayReadiness } from "../studioBridge.js";
import { providerIdFromDisplayName } from "./providerIdFromDisplayName.js";
import { sanitizeProvidersForSave } from "./sanitizeProvidersForSave.js";
import {
  EMPTY_MODEL_PROVIDER_FORM,
  type ModelConfigState,
  type ModelProviderConfig,
  type ModelProviderFormState,
} from "./types.js";

function sortProviders(providers: readonly ModelProviderConfig[]): ModelProviderConfig[] {
  return [...providers].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function saveStatusFor(
  appliesOn: ModelConfigState["appliesOn"],
  t: (key: string) => string,
): string {
  if (appliesOn === "next-turn") {
    return t("models.statusSavedNextTurn");
  }
  return t("models.statusSavedRestart");
}

export function useModelsPage() {
  const client = useGatewayClient();
  const t = useWorkbenchT();
  // Registered by Loong Studio when embedded; no-op in standalone gateway-dashboard.
  const studioReadiness = getStudioGatewayReadiness();
  const [modelConfig, setModelConfig] = useState<ModelConfigState>({
    providers: [],
    appliesOn: "restart",
  });
  const [liveProviders, setLiveProviders] = useState<readonly GatewayProviderSummary[]>([]);
  const [form, setForm] = useState<ModelProviderFormState>(EMPTY_MODEL_PROVIDER_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configPayload, providerList] = await Promise.all([
        client.rpc<ModelConfigState>("model.config.get"),
        client.listProviders().catch(() => [] as readonly GatewayProviderSummary[]),
      ]);
      setModelConfig({
        providers: configPayload.providers ?? [],
        appliesOn: configPayload.appliesOn ?? "restart",
        ...(configPayload.configPath ? { configPath: configPayload.configPath } : {}),
      });
      setLiveProviders(providerList);
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
      setLiveProviders(await client.listProviders().catch(() => []));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const persistProviders = useCallback(
    async (providers: readonly ModelProviderConfig[]) => {
      setSaving(true);
      setStatus(null);
      setError(null);
      try {
        const payload = await client.rpc<ModelConfigState>("model.config.save", {
          providers: sanitizeProvidersForSave(providers),
        });
        const appliesOn = payload.appliesOn ?? "restart";
        setModelConfig({
          providers: payload.providers ?? [],
          appliesOn,
          ...(payload.configPath ? { configPath: payload.configPath } : {}),
        });
        setStatus(saveStatusFor(appliesOn, t));
        if (studioReadiness) {
          await studioReadiness.ensureReady({ hotReloadSettleMs: 500 }).catch(() => false);
        }
        const providerList = await client
          .listProviders()
          .catch(() => [] as readonly GatewayProviderSummary[]);
        setLiveProviders(providerList);
      } catch (caught) {
        const message = caught instanceof GatewayApiError ? caught.message : String(caught);
        setError(message);
        throw caught;
      } finally {
        setSaving(false);
      }
    },
    [client, studioReadiness, t],
  );

  const clearForm = useCallback(() => {
    setForm(EMPTY_MODEL_PROVIDER_FORM);
  }, []);

  const editProvider = useCallback((id: string) => {
    const provider = modelConfig.providers.find(entry => entry.id === id);
    if (!provider) {
      return;
    }
    setForm({
      editingId: provider.id,
      type: provider.type,
      id: provider.id,
      displayName: provider.displayName ?? "",
      apiKey: "",
      baseUrl: provider.baseUrl ?? "",
      defaultModel: provider.defaultModel ?? "",
      enabled: provider.enabled !== false,
      supportsToolCalling: provider.supportsToolCalling !== false,
    });
  }, [modelConfig.providers]);

  const removeProvider = useCallback(
    async (id: string) => {
      const nextProviders = modelConfig.providers.filter(entry => entry.id !== id);
      setModelConfig(current => ({
        ...current,
        providers: nextProviders,
      }));
      setForm(current => (current.editingId === id ? EMPTY_MODEL_PROVIDER_FORM : current));
      await persistProviders(nextProviders);
    },
    [modelConfig.providers, persistProviders],
  );

  const upsertDraft = useCallback(async () => {
    const displayName = form.displayName.trim();
    if (!displayName) {
      return;
    }

    const id = form.id.trim() || providerIdFromDisplayName(displayName);

    const provider: ModelProviderConfig = {
      id,
      type: form.type,
      enabled: form.enabled,
      supportsToolCalling: form.supportsToolCalling,
    };

    const apiKey = form.apiKey.trim();
    const baseUrl = form.baseUrl.trim();
    const defaultModel = form.defaultModel.trim();
    if (displayName) {
      provider.displayName = displayName;
    }
    if (apiKey) {
      provider.apiKey = apiKey;
    }
    if (baseUrl) {
      provider.baseUrl = baseUrl;
    }
    if (defaultModel) {
      provider.defaultModel = defaultModel;
    }

    const existing = modelConfig.providers.find(
      entry => entry.id === id || entry.id === form.editingId,
    );
    if (!apiKey && existing?.apiKeyConfigured && existing.id === id) {
      provider.apiKeyConfigured = true;
    }

    const next = modelConfig.providers.filter(
      entry => entry.id !== id && entry.id !== form.editingId,
    );
    next.push(provider);

    const nextProviders = sortProviders(next);
    setModelConfig(current => ({
      ...current,
      providers: nextProviders,
    }));
    clearForm();
    await persistProviders(nextProviders);
  }, [clearForm, form, modelConfig.providers, persistProviders]);

  return {
    modelConfig,
    liveProviders,
    form,
    setForm,
    status,
    error,
    loading,
    saving,
    load,
    upsertDraft,
    clearForm,
    editProvider,
    removeProvider,
  };
}

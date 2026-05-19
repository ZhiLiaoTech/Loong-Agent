import { useCallback, useEffect, useState } from "react";
import { GatewayApiError } from "../../api/errors.js";
import type { GatewayProviderSummary } from "../../api/types.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";
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

export function useModelsPage() {
  const client = useGatewayClient();
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

  const removeProvider = useCallback((id: string) => {
    setModelConfig(current => ({
      ...current,
      providers: current.providers.filter(entry => entry.id !== id),
    }));
    setForm(current => (current.editingId === id ? EMPTY_MODEL_PROVIDER_FORM : current));
    setStatus(null);
  }, []);

  const upsertDraft = useCallback(() => {
    const id = form.id.trim();
    if (!id) {
      return;
    }

    const provider: ModelProviderConfig = {
      id,
      type: form.type,
      enabled: form.enabled,
      supportsToolCalling: form.supportsToolCalling,
    };

    const displayName = form.displayName.trim();
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

    setModelConfig(current => ({
      ...current,
      providers: sortProviders(next),
    }));
    clearForm();
    setStatus("Draft updated locally. Click Save to persist.");
  }, [clearForm, form, modelConfig.providers]);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    setStatus(null);
    setError(null);
    try {
      const payload = await client.rpc<ModelConfigState>("model.config.save", {
        providers: sanitizeProvidersForSave(modelConfig.providers),
      });
      setModelConfig({
        providers: payload.providers ?? [],
        appliesOn: payload.appliesOn ?? "restart",
        ...(payload.configPath ? { configPath: payload.configPath } : {}),
      });
      setStatus("Saved. Restart Gateway to apply provider changes.");
      const providerList = await client.listProviders().catch(() => [] as readonly GatewayProviderSummary[]);
      setLiveProviders(providerList);
    } catch (caught) {
      const message = caught instanceof GatewayApiError ? caught.message : String(caught);
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [client, modelConfig.providers]);

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
    saveConfig,
    upsertDraft,
    clearForm,
    editProvider,
    removeProvider,
  };
}

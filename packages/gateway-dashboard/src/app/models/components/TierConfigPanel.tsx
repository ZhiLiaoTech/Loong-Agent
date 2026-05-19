import { useCallback } from "react";
import styles from "./TierConfigPanel.module.css";
import type { TierConfigState, TierName, TierSpec } from "../types.js";
import type { useTiersPage } from "../useTiersPage.js";

interface Props {
  page: ReturnType<typeof useTiersPage>;
}

const TIER_LABELS: Record<TierName, string> = {
  fast: "Fast",
  standard: "Standard",
  deep: "Deep",
};

const TIER_HINTS: Record<TierName, string> = {
  fast: "Short prompts, no tools, minimal context. Lowest token spend.",
  standard: "Default bucket. Balanced context budget and reasoning.",
  deep: "Long prompts, attachments, multi-step plans. Highest thinking effort.",
};

export function TierConfigPanel({ page }: Props) {
  const { config, setConfig, supported, loading, saving, save, status, error } = page;
  const updateTier = useCallback((name: TierName, patch: Partial<TierSpec>) => {
    setConfig(current => ({
      ...current,
      tiers: {
        ...current.tiers,
        [name]: { ...(current.tiers[name] ?? {}), ...patch },
      },
    }));
  }, [setConfig]);

  const updateClassifier = useCallback((patch: Partial<TierConfigState["classifier"]>) => {
    setConfig(current => ({
      ...current,
      classifier: { ...current.classifier, ...patch },
    }));
  }, [setConfig]);

  if (supported === false) {
    return (
      <section className={styles.panel}>
        <header className={styles.header}>
          <h3 className={styles.title}>Tier scheduling</h3>
        </header>
        <p className={styles.muted}>
          The connected Gateway does not advertise tier scheduling capabilities. Update Dragon to enable
          multi-model tier routing.
        </p>
      </section>
    );
  }

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>Tier scheduling</h3>
          <p className={styles.lead}>
            Auto-route turns to fast / standard / deep models based on a heuristic classifier. Saved changes apply
            on the next turn.
          </p>
        </div>
        <div className={styles.actions}>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={event => setConfig(current => ({ ...current, enabled: event.target.checked }))}
              disabled={loading}
            />
            Enable tier routing
          </label>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void save()}
            disabled={saving || loading}
          >
            {saving ? "Saving…" : "Save tier config"}
          </button>
        </div>
      </header>

      {error ? <p className={styles.error}>{error}</p> : null}
      {status ? <p className={styles.status}>{status}</p> : null}
      {config.configPath ? <p className={styles.muted}>Persisted at {config.configPath}</p> : null}

      <div className={styles.classifier}>
        <h4 className={styles.subTitle}>Classifier</h4>
        <div className={styles.row}>
          <label className={styles.field}>
            <span>Mode</span>
            <select
              value={config.classifier.mode}
              onChange={event => updateClassifier({ mode: event.target.value as TierConfigState["classifier"]["mode"] })}
              disabled={!config.enabled || loading}
            >
              <option value="heuristic">Heuristic (auto)</option>
              <option value="fixed">Fixed (manual)</option>
            </select>
          </label>
          {config.classifier.mode === "fixed" ? (
            <label className={styles.field}>
              <span>Fixed tier</span>
              <select
                value={config.classifier.fixedTier ?? "standard"}
                onChange={event => updateClassifier({ fixedTier: event.target.value as TierName })}
                disabled={!config.enabled || loading}
              >
                <option value="fast">Fast</option>
                <option value="standard">Standard</option>
                <option value="deep">Deep</option>
              </select>
            </label>
          ) : null}
        </div>
      </div>

      <div className={styles.tiers}>
        {(["fast", "standard", "deep"] as const).map(name => {
          const spec = config.tiers[name] ?? {};
          return (
            <div key={name} className={styles.tierCard}>
              <header className={styles.tierHeader}>
                <h4 className={styles.tierTitle}>{TIER_LABELS[name]}</h4>
                <span className={styles.tierHint}>{TIER_HINTS[name]}</span>
              </header>
              <div className={styles.row}>
                <label className={styles.field}>
                  <span>Model (provider:model)</span>
                  <input
                    type="text"
                    placeholder="e.g. deepseek:deepseek-chat"
                    value={spec.model ?? ""}
                    onChange={event => updateTier(name, { model: event.target.value })}
                    disabled={!config.enabled || loading}
                  />
                </label>
                <label className={styles.field}>
                  <span>Thinking</span>
                  <select
                    value={spec.thinking ?? "none"}
                    onChange={event => {
                      const raw = event.target.value;
                      const next: NonNullable<TierSpec["thinking"]> | undefined =
                        raw === "none" || raw === "low" || raw === "medium" || raw === "high" ? raw : undefined;
                      updateTier(name, next !== undefined ? { thinking: next } : {});
                    }}
                    disabled={!config.enabled || loading}
                  >
                    <option value="none">none</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </label>
              </div>
              <div className={styles.row}>
                <label className={styles.field}>
                  <span>Max context chars</span>
                  <input
                    type="number"
                    min={500}
                    max={200_000}
                    step={500}
                    value={spec.maxContextChars ?? ""}
                    onChange={event => {
                      const raw = event.target.value;
                      updateTier(name, raw ? { maxContextChars: Number(raw) } : {});
                    }}
                    disabled={!config.enabled || loading}
                  />
                </label>
                <label className={styles.flagField}>
                  <input
                    type="checkbox"
                    checked={spec.toolsEnabled !== false}
                    onChange={event => updateTier(name, { toolsEnabled: event.target.checked })}
                    disabled={!config.enabled || loading}
                  />
                  Allow tool calls
                </label>
                <label className={styles.flagField}>
                  <input
                    type="checkbox"
                    checked={spec.memoryEnabled !== false}
                    onChange={event => updateTier(name, { memoryEnabled: event.target.checked })}
                    disabled={!config.enabled || loading}
                  />
                  Inject memory context
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <ClassifyTester page={page} />
    </section>
  );
}

function ClassifyTester({ page }: { page: ReturnType<typeof useTiersPage> }) {
  const { classifyMessage, setClassifyMessage, classifyResult, classify } = page;
  return (
    <div className={styles.tester}>
      <h4 className={styles.subTitle}>Test classifier</h4>
      <p className={styles.muted}>
        Paste a sample prompt to see which tier the heuristic chooses. No model call is made.
      </p>
      <div className={styles.testerRow}>
        <textarea
          value={classifyMessage}
          onChange={event => setClassifyMessage(event.target.value)}
          placeholder="e.g. 翻译这句话；e.g. design a multi-tenant rate limiter"
        />
        <button type="button" className={styles.secondary} onClick={() => void classify()}>
          Classify
        </button>
      </div>
      {classifyResult ? (
        <div className={styles.resultCard}>
          <div className={styles.resultLine}>
            <span className={styles.resultLabel}>Tier:</span>
            <strong className={`${styles.tierBadge} ${styles[`tierBadge_${classifyResult.tier}`]}`}>
              {TIER_LABELS[classifyResult.tier]}
            </strong>
            <span className={styles.resultMeta}>({classifyResult.source}, score={classifyResult.score})</span>
          </div>
          <div className={styles.resultLine}>
            <span className={styles.resultLabel}>Reason:</span>
            <code>{classifyResult.reason}</code>
          </div>
          {classifyResult.resolvedModel ? (
            <div className={styles.resultLine}>
              <span className={styles.resultLabel}>Resolved model:</span>
              <code>{classifyResult.resolvedModel}</code>
            </div>
          ) : null}
          {classifyResult.resolvedMaxContextChars !== undefined ? (
            <div className={styles.resultLine}>
              <span className={styles.resultLabel}>Max context:</span>
              <code>{classifyResult.resolvedMaxContextChars} chars</code>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

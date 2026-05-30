import type { ConfiguredModelOption } from "../../models/buildConfiguredModelOptions.js";
import { formatAgentModelLabel } from "../formatAgentModelLabel.js";
import type { AgentProfile } from "../types.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import wb from "../../workbench.module.css";
import styles from "../AgentsWorkspace.module.css";

export interface AgentCardListProps {
  profiles: readonly AgentProfile[];
  defaultProfileId?: string;
  modelOptions: readonly ConfiguredModelOption[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

function cardSummary(profile: AgentProfile): string {
  const description = profile.description?.trim();
  if (description) {
    return description;
  }

  const prompt = profile.systemPrompt?.trim();
  if (!prompt) {
    return "";
  }

  return prompt.length > 96 ? `${prompt.slice(0, 96)}…` : prompt;
}

export function AgentCardList({
  profiles,
  defaultProfileId,
  modelOptions,
  onAdd,
  onEdit,
  onRemove,
}: AgentCardListProps) {
  const t = useWorkbenchT();
  const optionValues = new Set(modelOptions.map(option => option.value));

  if (!profiles.length) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyStateText}>{t("agents.listEmpty")}</p>
        <button type="button" className={wb.btnPrimary} onClick={onAdd}>
          {t("agents.addFirstAgent")}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.agentGrid}>
      {profiles.map(profile => {
        const title = profile.name.trim() || profile.id;
        const modelRef = profile.defaultModel?.trim();
        const modelMissing = Boolean(modelRef && modelOptions.length > 0 && !optionValues.has(modelRef));
        const modelLabel = modelMissing
          ? t("agents.modelNeedsUpdate")
          : formatAgentModelLabel(modelRef, modelOptions) ?? t("agents.modelNotSet");
        const summary = cardSummary(profile);

        return (
          <article key={profile.id} className={styles.agentCard}>
            <div className={styles.agentCardHead}>
              <div className={styles.agentCardMain}>
                <div className={styles.agentCardTitleRow}>
                  <h3 className={styles.agentCardTitle}>{title}</h3>
                  {defaultProfileId === profile.id ? (
                    <span className={styles.badge}>{t("common.default")}</span>
                  ) : null}
                </div>
                <p
                  className={
                    modelMissing
                      ? `${styles.agentCardModel} ${styles.agentCardModelWarn}`
                      : styles.agentCardModel
                  }
                >
                  {modelLabel}
                </p>
                {summary ? <p className={styles.agentCardSummary}>{summary}</p> : null}
              </div>
            </div>
            <div className={styles.agentCardActions}>
              <button type="button" className={wb.btnSecondary} onClick={() => onEdit(profile.id)}>
                {t("common.edit")}
              </button>
              <button
                type="button"
                className={wb.btnDanger}
                onClick={() => {
                  if (globalThis.confirm?.(t("agents.removeConfirm").replace("{name}", title))) {
                    onRemove(profile.id);
                  }
                }}
              >
                {t("common.remove")}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

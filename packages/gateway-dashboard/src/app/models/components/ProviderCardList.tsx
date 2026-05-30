import type { ModelProviderConfig } from "../types.js";
import { useWorkbenchT } from "../../i18n/WorkbenchI18nContext.js";
import wb from "../../workbench.module.css";
import styles from "../ModelsWorkspace.module.css";

export interface ProviderCardListProps {
  providers: readonly ModelProviderConfig[];
  onAdd: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export function ProviderCardList({
  providers,
  onAdd,
  onEdit,
  onRemove,
}: ProviderCardListProps) {
  const t = useWorkbenchT();

  if (!providers.length) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.emptyStateText}>{t("models.configTableEmpty")}</p>
        <button type="button" className={wb.btnPrimary} onClick={onAdd}>
          {t("models.addFirstProvider")}
        </button>
      </div>
    );
  }

  return (
    <div className={styles.cardList}>
      {providers.map(provider => {
        const title = provider.displayName?.trim() || provider.id;
        const modelName = provider.defaultModel?.trim();

        return (
          <article key={provider.id} className={styles.providerCard}>
            <div className={styles.providerCardHead}>
              <div className={styles.providerCardMain}>
                <div className={styles.providerCardTitleRow}>
                  <h3 className={styles.providerCardTitle}>{title}</h3>
                  {provider.enabled === false ? (
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>
                      {t("models.statusPaused")}
                    </span>
                  ) : null}
                  {!provider.apiKeyConfigured && !provider.apiKey ? (
                    <span className={`${styles.badge} ${styles.badgeWarn}`}>
                      {t("models.keyMissingBadge")}
                    </span>
                  ) : null}
                </div>
                <p className={styles.providerCardMeta}>
                  {modelName
                    ? t("models.cardDefaultModel").replace("{model}", modelName)
                    : t("models.noDefaultModel")}
                </p>
              </div>
              <div className={styles.providerCardActions}>
                <button type="button" className={wb.btnSecondary} onClick={() => onEdit(provider.id)}>
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  className={wb.btnDanger}
                  onClick={() => {
                    if (globalThis.confirm?.(t("models.removeConfirm").replace("{name}", title))) {
                      onRemove(provider.id);
                    }
                  }}
                >
                  {t("common.remove")}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

import { Drawer } from "../../../components/Drawer.js";
import type { useTiersPage } from "../../useTiersPage.js";
import { useWorkbenchT } from "../../../i18n/WorkbenchI18nContext.js";
import wb from "../../../workbench.module.css";
import styles from "../TierConfigPanel.module.css";
import { tierNameKey } from "./labels.js";

interface Props {
  open: boolean;
  onClose: () => void;
  page: ReturnType<typeof useTiersPage>;
}

export function TierClassifyDrawer({ open, onClose, page }: Props) {
  const t = useWorkbenchT();
  const { classifyMessage, setClassifyMessage, classifyResult, classify } = page;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("models.tier.drawerTitle")}
      subtitle={t("models.tier.drawerSubtitle")}
    >
      <label className={styles.drawerField}>
        <span>{t("models.tier.samplePrompt")}</span>
        <textarea
          value={classifyMessage}
          onChange={event => setClassifyMessage(event.target.value)}
          placeholder={t("models.tier.samplePlaceholder")}
          rows={6}
        />
      </label>
      <button type="button" className={wb.btnPrimary} onClick={() => void classify()}>
        {t("models.tier.startClassify")}
      </button>

      {classifyResult ? (
        <article className={styles.decisionCard} aria-live="polite">
          <header className={styles.decisionHeader}>
            <span
              className={`${styles.resultBadge} ${styles[`resultBadge_${classifyResult.tier}`]}`}
            >
              {t("models.tier.previewResult").replace("{tier}", t(tierNameKey(classifyResult.tier)))}
            </span>
          </header>
          {classifyResult.resolvedModel ? (
            <p className={styles.drawerResultModel}>
              {t("models.tier.previewModel").replace(
                "{model}",
                classifyResult.resolvedModel.split(":").slice(-1)[0] ?? classifyResult.resolvedModel,
              )}
            </p>
          ) : null}
        </article>
      ) : (
        <p className={styles.drawerEmpty}>{t("models.tier.drawerEmpty")}</p>
      )}
    </Drawer>
  );
}

import { useWorkbenchT } from "../i18n/WorkbenchI18nContext.js";
import wb from "../workbench.module.css";
import { IM_CHANNEL_CATALOG } from "./imCatalog.js";
import styles from "./ConnectionsWorkspace.module.css";

export function ConnectionsWorkspace() {
  const t = useWorkbenchT();

  return (
    <div className={wb.page}>
      <header className={wb.pageHeader}>
        <div>
          <h1 className={wb.pageTitle}>{t("connections.title")}</h1>
          <p className={wb.pageLead}>{t("connections.lead")}</p>
        </div>
      </header>

      <div className={styles.grid} role="list" aria-label={t("connections.gridLabel")}>
        {IM_CHANNEL_CATALOG.map(channel => (
          <article
            key={channel.id}
            className={styles.card}
            role="listitem"
            aria-labelledby={`connection-${channel.id}-title`}
          >
            <div className={styles.cardHead}>
              <div
                className={styles.brand}
                style={{ backgroundColor: channel.accent }}
                aria-hidden
              >
                {channel.glyph}
              </div>
              <span
                className={
                  channel.status === "available"
                    ? `${styles.badge} ${styles.badgeAvailable}`
                    : `${styles.badge} ${styles.badgeSoon}`
                }
              >
                {channel.status === "available"
                  ? t("connections.statusAvailable")
                  : t("connections.statusComingSoon")}
              </span>
            </div>
            <div>
              <h2 className={styles.cardTitle} id={`connection-${channel.id}-title`}>
                {t(channel.nameKey)}
              </h2>
              <p className={styles.cardDescription}>{t(channel.descriptionKey)}</p>
            </div>
            <p className={styles.cardFooter}>
              {channel.status === "available"
                ? t("connections.availableHint")
                : t("connections.comingSoonHint")}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

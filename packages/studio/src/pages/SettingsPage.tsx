import { useState } from "react";

import { resolveGatewayUrl } from "@loong/client";

import { applyThemeMode, getThemeMode, type ThemeMode } from "@loong/ui";

import { useHost } from "../context/HostContext.js";

import { useLoongClient } from "../context/LoongClientContext.js";

import { useStudioGatewayReadiness } from "../context/GatewayReadinessContext.js";

import { useGatewayReadiness } from "../hooks/useGatewayReadiness.js";

import { useI18n } from "../i18n/I18nContext.js";

import type { Locale } from "../i18n/types.js";

import { PageHeader } from "../components/layout/PageHeader.js";

import { PageShell } from "../components/layout/PageShell.js";

import styles from "../components/layout/ContentPage.module.css";

export function SettingsPage() {
  const { t, locale, setLocale } = useI18n();
  const { secret, setSecret, client } = useLoongClient();
  const host = useHost();
  const { refresh } = useGatewayReadiness();
  const { ensureReady } = useStudioGatewayReadiness();

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getThemeMode());
  const [readinessMessage, setReadinessMessage] = useState<string | null>(null);
  const [readinessOk, setReadinessOk] = useState<boolean | null>(null);

  const handleThemeChange = (mode: ThemeMode) => {
    setThemeMode(mode);
    applyThemeMode(mode);
  };

  return (
    <PageShell variant="content">
      <PageHeader title={t("settings.title")} lead={t("settings.lead")} />

      <div className={styles.layout}>
        <section className={styles.sectionGroup} aria-labelledby="settings-general">
          <div className={styles.groupHead}>
            <h2 id="settings-general" className={styles.groupTitle}>
              {t("settings.sectionGeneral")}
            </h2>
            <p className={styles.groupLead}>{t("settings.sectionGeneralLead")}</p>
          </div>

          <article className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.title}>{t("settings.appearance")}</h3>
            </div>
            <div className={styles.cardBody}>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>
                  {t("settings.language")}
                  <select
                    className={styles.select}
                    value={locale}
                    onChange={event => setLocale(event.target.value as Locale)}
                  >
                    <option value="zh-CN">{t("settings.languageZh")}</option>
                    <option value="en">{t("settings.languageEn")}</option>
                  </select>
                </label>
                <label className={styles.field}>
                  {t("settings.theme")}
                  <select
                    className={styles.select}
                    value={themeMode}
                    onChange={event => handleThemeChange(event.target.value as ThemeMode)}
                  >
                    <option value="dark">{t("settings.themeDark")}</option>
                    <option value="light">{t("settings.themeLight")}</option>
                  </select>
                </label>
              </div>
            </div>
          </article>
        </section>

        <section className={styles.sectionGroup} aria-labelledby="settings-connection">
          <div className={styles.groupHead}>
            <h2 id="settings-connection" className={styles.groupTitle}>
              {t("settings.sectionConnection")}
            </h2>
            <p className={styles.groupLead}>{t("settings.sectionConnectionLead")}</p>
          </div>

          <article className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.title}>{t("settings.gatewayUrl")}</h3>
            </div>
            <div className={styles.cardBody}>
              <div className={styles.codeBlock}>
                <code>{resolveGatewayUrl(client.gatewayConfig.baseUrl)}</code>
              </div>
              <hr className={styles.divider} />
              <label className={styles.field}>
                {t("settings.sharedSecret")}
                <input
                  type="password"
                  className={styles.input}
                  value={secret}
                  onChange={event => setSecret(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <p className={styles.hint}>{t("settings.secretHint")}</p>
            </div>
          </article>
        </section>

        <section className={styles.sectionGroup} aria-labelledby="settings-advanced">
          <div className={styles.groupHead}>
            <h2 id="settings-advanced" className={styles.groupTitle}>
              {t("settings.sectionAdvanced")}
            </h2>
            <p className={styles.groupLead}>{t("settings.sectionAdvancedLead")}</p>
          </div>

          <article className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.title}>{t("settings.gatewayReadiness")}</h3>
            </div>
            <div className={styles.cardBody}>
              <p className={styles.hint}>{t("settings.gatewayReadinessHint")}</p>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.buttonPrimary}
                  onClick={() => {
                    void ensureReady({
                      onProgress: progress =>
                        setReadinessMessage(progress.message ?? progress.stage),
                    }).then(ok => {
                      setReadinessOk(ok);
                      setReadinessMessage(
                        ok ? t("settings.gatewayReady") : t("settings.gatewayNotReady"),
                      );
                    });
                  }}
                >
                  {t("settings.checkReadiness")}
                </button>
              </div>
              {readinessMessage ? (
                <p
                  className={readinessOk ? styles.statusOk : styles.statusError}
                  role="status"
                >
                  {readinessMessage}
                </p>
              ) : null}
            </div>
          </article>
        </section>

        <section className={styles.sectionGroup} aria-labelledby="settings-about">
          <div className={styles.groupHead}>
            <h2 id="settings-about" className={styles.groupTitle}>
              {t("settings.sectionAbout")}
            </h2>
          </div>

          <article className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.title}>{t("about.title")}</h3>
            </div>
            <div className={styles.cardBody}>
              <p className={styles.lead}>{t("about.lead")}</p>
              <ul className={styles.metaList}>
                <li className={styles.metaRow}>
                  <span className={styles.metaLabel}>{t("about.surface")}</span>
                  <span className={styles.metaValue}>
                    <strong>{host.capabilities.surface}</strong>
                  </span>
                </li>
                <li className={styles.metaRow}>
                  <span className={styles.metaLabel}>{t("about.gatewayLifecycle")}</span>
                  <span className={styles.metaValue}>
                    <strong>
                      {host.capabilities.gatewayLifecycle
                        ? t("common.yes")
                        : t("about.gatewayLifecycleNo")}
                    </strong>
                  </span>
                </li>
              </ul>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.buttonPrimary}
                  onClick={async () => {
                    void refresh();
                    try {
                      const caps = await client.gateway.connect();
                      alert(`${t("about.connectedCapabilities")}${caps.capabilities.length}`);
                    } catch (error) {
                      alert(error instanceof Error ? error.message : String(error));
                    }
                  }}
                >
                  {t("about.testConnect")}
                </button>
              </div>
            </div>
          </article>
        </section>
      </div>
    </PageShell>
  );
}

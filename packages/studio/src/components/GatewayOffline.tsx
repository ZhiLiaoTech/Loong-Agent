import { resolveGatewayUrl } from "@loong/client";
import { useLoongClient } from "../context/LoongClientContext.js";
import { useI18n } from "../i18n/I18nContext.js";
import { PageShell } from "./layout/PageShell.js";
import styles from "./GatewayOffline.module.css";

export function GatewayOffline({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  const { client } = useLoongClient();
  const gatewayUrl = resolveGatewayUrl(client.gatewayConfig.baseUrl);

  return (
    <PageShell variant="content">
      <div className={styles.page}>
        <h2 className={styles.title}>{t("gateway.offlineTitle")}</h2>
        <p className={styles.lead}>
          {t("gateway.offlineLead")} <code>{gatewayUrl}</code>.
        </p>
        <ol className={styles.steps}>
          <li>
            {t("gateway.stepRun")}
            <pre className={styles.pre}>{`node packages/cli/dist/index.js gateway`}</pre>
          </li>
          <li>{t("gateway.stepWait")}</li>
          <li>{t("gateway.stepRetry")}</li>
        </ol>
        <button type="button" className={styles.button} onClick={onRetry}>
          {t("gateway.retry")}
        </button>
      </div>
    </PageShell>
  );
}

import { useI18n } from "../i18n/I18nContext.js";
import styles from "./AuthBanner.module.css";

export function AuthBanner({ visible }: { visible: boolean }) {
  const { t } = useI18n();

  if (!visible) {
    return null;
  }
  return (
    <div className={styles.banner} role="status">
      {t("auth.banner")}
    </div>
  );
}

import { useCallback, useState } from "react";
import { ModelProviderDrawer } from "./components/ModelProviderDrawer.js";
import { ProviderCardList } from "./components/ProviderCardList.js";
import { TierTab } from "./components/TierTab.js";
import { useWorkbenchT } from "../i18n/WorkbenchI18nContext.js";
import wb from "../workbench.module.css";
import styles from "./ModelsWorkspace.module.css";
import { useModelsPage } from "./useModelsPage.js";
import { useTiersPage } from "./useTiersPage.js";

type ModelsTab = "providers" | "tiers";

export function ModelsWorkspace() {
  const t = useWorkbenchT();
  const page = useModelsPage();
  const tiers = useTiersPage();
  const [activeTab, setActiveTab] = useState<ModelsTab>("providers");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"add" | "edit">("add");

  const openAddDrawer = useCallback(() => {
    page.clearForm();
    setDrawerMode("add");
    setDrawerOpen(true);
  }, [page]);

  const openEditDrawer = useCallback(
    (id: string) => {
      page.editProvider(id);
      setDrawerMode("edit");
      setDrawerOpen(true);
    },
    [page],
  );

  const closeDrawer = useCallback(() => {
    if (page.saving) {
      return;
    }
    setDrawerOpen(false);
    page.clearForm();
  }, [page]);

  const handleSaveProvider = useCallback(async () => {
    try {
      await page.upsertDraft();
      setDrawerOpen(false);
    } catch {
      // error surfaced via page.error
    }
  }, [page]);

  return (
    <div className={wb.page}>
      <header className={wb.pageHeader}>
        <div>
          <h1 className={wb.pageTitle}>{t("models.title")}</h1>
          <p className={wb.pageLead}>{t("models.lead")}</p>
        </div>
        <div className={wb.pageHeaderActions}>
          <button
            type="button"
            className={wb.btnSecondary}
            onClick={() => void page.load()}
            disabled={page.loading || page.saving}
          >
            {t("common.refresh")}
          </button>
        </div>
      </header>

      {page.error || page.status ? (
        <div className={wb.pageAlerts}>
          {page.error ? <p className={wb.bannerError}>{page.error}</p> : null}
          {page.status ? <p className={wb.bannerOk}>{page.status}</p> : null}
        </div>
      ) : null}

      <div className={styles.tabs} role="tablist" aria-label={t("models.title")}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "providers"}
          className={activeTab === "providers" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setActiveTab("providers")}
        >
          {t("models.tabProviders")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "tiers"}
          className={activeTab === "tiers" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setActiveTab("tiers")}
        >
          {t("models.tabTiers")}
        </button>
      </div>

      {activeTab === "providers" ? (
        <section className={styles.tabPanel} role="tabpanel">
          <div className={styles.panelToolbar}>
            <div className={styles.panelToolbarCopy}>
              <h2 className={styles.panelToolbarTitle}>
                {t("models.configTableTitle")} ({page.modelConfig.providers.length})
              </h2>
            </div>
            <div className={styles.panelToolbarActions}>
              <button type="button" className={wb.btnPrimary} onClick={openAddDrawer}>
                {t("models.addProvider")}
              </button>
            </div>
          </div>

          <ProviderCardList
            providers={page.modelConfig.providers}
            onAdd={openAddDrawer}
            onEdit={openEditDrawer}
            onRemove={id => void page.removeProvider(id)}
          />
        </section>
      ) : (
        <section className={styles.tabPanel} role="tabpanel">
          <TierTab page={tiers} providers={page.modelConfig.providers} />
        </section>
      )}

      <ModelProviderDrawer
        open={drawerOpen}
        mode={drawerMode}
        form={page.form}
        saving={page.saving}
        onChange={patch => page.setForm(current => ({ ...current, ...patch }))}
        onClose={closeDrawer}
        onSave={() => void handleSaveProvider()}
      />
    </div>
  );
}

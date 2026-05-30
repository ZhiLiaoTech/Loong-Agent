import { useCallback, useState } from "react";
import { AgentCardList } from "./components/AgentCardList.js";
import { AgentProfileDrawer } from "./components/AgentProfileDrawer.js";
import { useWorkbenchT } from "../i18n/WorkbenchI18nContext.js";
import wb from "../workbench.module.css";
import styles from "./AgentsWorkspace.module.css";
import { useAgentsPage } from "./useAgentsPage.js";

export function AgentsWorkspace() {
  const t = useWorkbenchT();
  const page = useAgentsPage();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<"add" | "edit">("add");

  const openAddDrawer = useCallback(() => {
    page.clearForm();
    page.setForm(current => ({
      ...current,
      isDefault: page.agentConfig.profiles.length === 0 || !page.agentConfig.defaultProfileId,
    }));
    setDrawerMode("add");
    setDrawerOpen(true);
  }, [page]);

  const openEditDrawer = useCallback(
    (id: string) => {
      page.editProfile(id);
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

  const handleSave = useCallback(async () => {
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
          <h1 className={wb.pageTitle}>{t("agents.title")}</h1>
          <p className={wb.pageLead}>{t("agents.lead")}</p>
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

      <section className={wb.pageSection} aria-labelledby="agents-list-heading">
        <div className={styles.panelToolbar}>
          <div className={styles.panelToolbarCopy}>
            <h2 id="agents-list-heading" className={styles.panelToolbarTitle}>
              {t("agents.listTitle")} ({page.agentConfig.profiles.length})
            </h2>
          </div>
          <div className={styles.panelToolbarActions}>
            <button type="button" className={wb.btnPrimary} onClick={openAddDrawer}>
              {t("agents.addAgent")}
            </button>
          </div>
        </div>

        <AgentCardList
          profiles={page.agentConfig.profiles}
          {...(page.agentConfig.defaultProfileId
            ? { defaultProfileId: page.agentConfig.defaultProfileId }
            : {})}
          modelOptions={page.modelOptions}
          onAdd={openAddDrawer}
          onEdit={openEditDrawer}
          onRemove={id => void page.removeProfile(id)}
        />
      </section>

      <AgentProfileDrawer
        open={drawerOpen}
        mode={drawerMode}
        form={page.form}
        modelOptions={page.modelOptions}
        saving={page.saving}
        onChange={patch => page.setForm(current => ({ ...current, ...patch }))}
        onClose={closeDrawer}
        onSave={() => void handleSave()}
      />
    </div>
  );
}

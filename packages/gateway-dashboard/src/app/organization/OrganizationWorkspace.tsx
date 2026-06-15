import { useCallback, useState } from "react";
import { CapabilityTab } from "./components/CapabilityTab.js";
import { OrganizationIdentityTab } from "./components/OrganizationIdentityTab.js";
import { useWorkbenchT } from "../i18n/WorkbenchI18nContext.js";
import wb from "../workbench.module.css";
import modelStyles from "../models/ModelsWorkspace.module.css";
import { useOrgEmployeePage } from "./useOrgEmployeePage.js";
import { CronTasksTab } from "./components/CronTasksTab.js";
import { SuiteImportTab } from "./components/SuiteImportTab.js";
import { useEmployeeCronJobs } from "./useEmployeeCronJobs.js";

type OrganizationTab = "capability" | "identity" | "suite" | "cron";

export function OrganizationWorkspace() {
  const t = useWorkbenchT();
  const page = useOrgEmployeePage();
  const [activeTab, setActiveTab] = useState<OrganizationTab>("capability");
  const cron = useEmployeeCronJobs(page.form.profileId);

  const handleSave = useCallback(async () => {
    try {
      await page.save();
    } catch {
      // surfaced via page.error
    }
  }, [page]);

  const identityLine = [page.form.displayName, page.unitName, page.positionName]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={wb.page}>
      <header className={wb.pageHeader}>
        <div>
          <h1 className={wb.pageTitle}>{t("org.title")}</h1>
          <p className={wb.pageLead}>{t("org.lead")}</p>
          {identityLine ? <p className={wb.pageLead}>{identityLine}</p> : null}
        </div>
        <div className={wb.pageHeaderActions}>
          {!page.units.length ? (
            <button
              type="button"
              className={wb.btnSecondary}
              onClick={() => void page.bootstrapExample()}
              disabled={page.loading || page.bootstrapping}
            >
              {page.bootstrapping ? t("org.bootstrapping") : t("org.bootstrapExample")}
            </button>
          ) : null}
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

      <div className={modelStyles.tabs} role="tablist" aria-label={t("org.title")}>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "capability"}
          className={activeTab === "capability" ? `${modelStyles.tab} ${modelStyles.tabActive}` : modelStyles.tab}
          onClick={() => setActiveTab("capability")}
        >
          {t("org.tabCapability")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "identity"}
          className={activeTab === "identity" ? `${modelStyles.tab} ${modelStyles.tabActive}` : modelStyles.tab}
          onClick={() => setActiveTab("identity")}
        >
          {t("org.tabIdentity")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "cron"}
          className={activeTab === "cron" ? `${modelStyles.tab} ${modelStyles.tabActive}` : modelStyles.tab}
          onClick={() => setActiveTab("cron")}
        >
          定时任务
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "suite"}
          className={activeTab === "suite" ? `${modelStyles.tab} ${modelStyles.tabActive}` : modelStyles.tab}
          onClick={() => setActiveTab("suite")}
        >
          Suite
        </button>
      </div>

      <section className={modelStyles.tabPanel} role="tabpanel">
        {activeTab === "capability" ? (
          <CapabilityTab
            form={page.form}
            skills={page.skills}
            skillsAvailable={page.skillsAvailable}
            {...(page.skillWarning ? { skillWarning: page.skillWarning } : {})}
            memoryCandidates={page.memoryCandidates}
            {...(page.positionName ? { positionName: page.positionName } : {})}
            saving={page.saving}
            onChange={patch => page.updateForm(patch)}
            onApplyPositionPreset={() => page.applyPositionPreset()}
            onSave={() => void handleSave()}
          />
        ) : activeTab === "cron" ? (
          <CronTasksTab
            jobs={cron.jobs}
            loading={cron.loading}
            error={cron.error}
            busyId={cron.busyId}
            onToggle={job => void cron.toggle(job)}
            onRefresh={() => void cron.refresh()}
          />
        ) : activeTab === "suite" ? (
          <SuiteImportTab
            onImported={result => {
              const options: NonNullable<Parameters<typeof page.load>[0]> = {};
              if (result.orgEmployeeId) {
                options.preferredEmployeeId = result.orgEmployeeId;
              }
              if (result.profileId) {
                options.preferredProfileId = result.profileId;
              }
              return page.load(options);
            }}
          />
        ) : (
          <OrganizationIdentityTab
            form={page.form}
            units={page.units}
            positions={page.positions}
            policies={page.policies}
            peers={page.peers}
            {...(page.policy ? { policy: page.policy } : {})}
            {...(page.managerName ? { managerName: page.managerName } : {})}
            saving={page.saving}
            onChange={patch => page.updateForm(patch)}
            onSave={() => void handleSave()}
          />
        )}
      </section>
    </div>
  );
}

import { CronPanel } from "./components/CronPanel.js";
import { HealthPanel } from "./components/HealthPanel.js";
import { PluginsPanel } from "./components/PluginsPanel.js";
import { ToolsPanel } from "./components/ToolsPanel.js";
import styles from "./SystemWorkspace.module.css";
import { useSystemPage } from "./useSystemPage.js";

export function SystemWorkspace() {
  const page = useSystemPage();

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>System</h2>
          <p className={styles.lead}>
            Gateway health, scheduled jobs, plugins, and direct tool invocation.
          </p>
        </div>
      </header>

      {page.error ? <p className={styles.error}>{page.error}</p> : null}

      <div className={styles.grid}>
        <HealthPanel
          health={page.health}
          loading={page.loading}
          onRefresh={() => void page.refreshHealth()}
        />
        <CronPanel
          jobs={page.cronJobs}
          form={page.cronForm}
          result={page.cronResult}
          saving={page.cronSaving}
          loading={page.loading}
          onChange={patch => page.setCronForm(current => ({ ...current, ...patch }))}
          onSave={() => void page.saveCronJob()}
          onClear={page.clearCronForm}
          onEdit={page.editCronJob}
          onRemove={id => void page.removeCronJob(id)}
          onTick={() => void page.tickCron()}
          onRefresh={() => void page.refreshCronJobs()}
        />
      </div>

      <div className={styles.grid}>
        <PluginsPanel
          plugins={page.plugins}
          loading={page.loading}
          onRefresh={() => void page.refreshPlugins()}
        />
        <ToolsPanel
          tools={page.tools}
          workspace={page.toolWorkspace}
          result={page.toolResult}
          loading={page.loading}
          onWorkspaceChange={page.setToolWorkspace}
          onRefresh={() => void page.refreshTools()}
          onInvoke={name => void page.invokeTool(name)}
        />
      </div>
    </div>
  );
}

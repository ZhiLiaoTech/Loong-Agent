import { AgentProfileForm } from "./components/AgentProfileForm.js";
import { AgentProfilesTable } from "./components/AgentProfilesTable.js";
import styles from "./AgentsWorkspace.module.css";
import { useAgentsPage } from "./useAgentsPage.js";

export function AgentsWorkspace() {
  const page = useAgentsPage();

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Agents</h2>
          <p className={styles.lead}>
            Define agent profiles with defaults for model, workspace, thinking, and tools.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondary}
            onClick={() => void page.load()}
            disabled={page.loading}
          >
            Refresh
          </button>
          <button
            type="button"
            className={styles.primary}
            onClick={() => void page.saveConfig()}
            disabled={page.saving || page.loading}
          >
            {page.saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {page.error ? <p className={styles.error}>{page.error}</p> : null}
      {page.status ? <p className={styles.status}>{page.status}</p> : null}

      <div className={styles.grid}>
        <AgentProfileForm
          form={page.form}
          modelSuggestions={page.modelSuggestions}
          onChange={patch => page.setForm(current => ({ ...current, ...patch }))}
          onUpsert={page.upsertDraft}
          onClear={page.clearForm}
        />
        <AgentProfilesTable
          profiles={page.agentConfig.profiles}
          {...(page.agentConfig.defaultProfileId
            ? { defaultProfileId: page.agentConfig.defaultProfileId }
            : {})}
          {...(page.agentConfig.configPath ? { configPath: page.agentConfig.configPath } : {})}
          onEdit={page.editProfile}
          onRemove={page.removeProfile}
        />
      </div>
    </div>
  );
}

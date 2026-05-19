import { LoadedProvidersTable } from "./components/LoadedProvidersTable.js";
import { ModelConfigTable } from "./components/ModelConfigTable.js";
import { ModelProviderForm } from "./components/ModelProviderForm.js";
import styles from "./ModelsWorkspace.module.css";
import { useModelsPage } from "./useModelsPage.js";

export function ModelsWorkspace() {
  const page = useModelsPage();

  return (
    <div className={styles.workspace}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>Models</h2>
          <p className={styles.lead}>
            Configure provider credentials. Changes apply after Gateway restart.
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
        <ModelProviderForm
          form={page.form}
          onChange={patch => page.setForm(current => ({ ...current, ...patch }))}
          onUpsert={page.upsertDraft}
          onClear={page.clearForm}
        />
        <ModelConfigTable
          providers={page.modelConfig.providers}
          {...(page.modelConfig.configPath
            ? { configPath: page.modelConfig.configPath }
            : {})}
          onEdit={page.editProvider}
          onRemove={page.removeProvider}
        />
      </div>

      <LoadedProvidersTable
        providers={page.liveProviders}
        loading={page.loading}
        onRefresh={() => void page.load()}
      />
    </div>
  );
}

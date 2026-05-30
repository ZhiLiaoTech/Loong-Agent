import { ModelsWorkspace } from "@dashboard/app/models/ModelsWorkspace.js";
import { PageShell } from "../components/layout/PageShell.js";

export function ModelsPage() {
  return (
    <PageShell variant="workbench">
      <ModelsWorkspace />
    </PageShell>
  );
}

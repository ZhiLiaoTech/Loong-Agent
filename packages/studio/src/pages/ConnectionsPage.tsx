import { ConnectionsWorkspace } from "@dashboard/app/connections/ConnectionsWorkspace.js";
import { PageShell } from "../components/layout/PageShell.js";

export function ConnectionsPage() {
  return (
    <PageShell variant="workbench">
      <ConnectionsWorkspace />
    </PageShell>
  );
}

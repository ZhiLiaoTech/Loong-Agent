import { AgentsWorkspace } from "@dashboard/app/agents/AgentsWorkspace.js";
import { PageShell } from "../components/layout/PageShell.js";

export function AgentsPage() {
  return (
    <PageShell variant="workbench">
      <AgentsWorkspace />
    </PageShell>
  );
}

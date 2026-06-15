import { PageShell } from "../components/layout/PageShell.js";
import { StudioObserveWorkspace } from "../components/observe/StudioObserveWorkspace.js";

export function ObservePage() {
  return (
    <PageShell variant="workbench">
      <StudioObserveWorkspace />
    </PageShell>
  );
}

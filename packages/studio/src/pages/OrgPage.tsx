import { OrganizationWorkspace } from "@dashboard/app/organization/OrganizationWorkspace.js";
import { PageShell } from "../components/layout/PageShell.js";

export function OrgPage() {
  return (
    <PageShell variant="workbench">
      <OrganizationWorkspace />
    </PageShell>
  );
}

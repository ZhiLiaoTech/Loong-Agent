import { useCallback, useEffect, useMemo, useState } from "react";

import type { WorkspaceScopeSelection } from "@dashboard/app/run/workspaceScope.js";

import {

  addCustomScopePath,

  basenameScopePath,

  loadCustomScopePaths,

  parseScopeMenuValue,

  scopeMenuValue,

} from "@dashboard/app/run/workspaceScope.js";

import { useI18n } from "../../i18n/I18nContext.js";

import { ChatToolbarMenu } from "./ChatToolbarMenu.js";

import { DirectoryBrowserDialog } from "./DirectoryBrowserDialog.js";



export function ChatScopeSelector({

  selection,

  profileWorkspace,

  disabled = false,

  onChange,

}: {

  selection: WorkspaceScopeSelection;

  profileWorkspace?: string;

  disabled?: boolean;

  onChange: (selection: WorkspaceScopeSelection) => void;

}) {

  const { t } = useI18n();

  const [customPaths, setCustomPaths] = useState<string[]>(() => loadCustomScopePaths());

  const [dialogOpen, setDialogOpen] = useState(false);



  useEffect(() => {

    setCustomPaths(loadCustomScopePaths());

  }, [selection.kind, selection.path]);



  const menuOptions = useMemo(() => {

    const options = [

      { value: "global", label: t("chat.scopeGlobal"), hint: t("chat.scopeGlobalHint") },

      {

        value: "workspace",

        label: t("chat.scopeWorkspace"),

        hint: profileWorkspace || t("chat.scopeWorkspaceMissing"),

      },

      ...customPaths.map(path => ({

        value: `custom:${path}`,

        label: basenameScopePath(path),

        hint: path,

      })),

      { value: "__pick__", label: t("chat.scopePickDirectory"), hint: t("chat.scopePickDirectoryHint") },

    ];

    return options;

  }, [customPaths, profileWorkspace, t]);



  const handleMenuChange = useCallback((value: string) => {

    if (value === "__pick__") {

      setDialogOpen(true);

      return;

    }

    const parsed = parseScopeMenuValue(value);

    if (!parsed) {

      return;

    }

    if (parsed.kind === "workspace") {

      onChange({

        kind: "workspace",

        ...(profileWorkspace ? { path: profileWorkspace } : {}),

      });

      return;

    }

    onChange(parsed);

  }, [onChange, profileWorkspace]);



  const handleDirectorySelect = useCallback((path: string) => {

    const nextPaths = addCustomScopePath(path);

    setCustomPaths(nextPaths);

    onChange({ kind: "custom", path });

    setDialogOpen(false);

  }, [onChange]);



  return (

    <>

      <ChatToolbarMenu

        value={scopeMenuValue(selection)}

        options={menuOptions}

        onChange={handleMenuChange}

        disabled={disabled}

        ariaLabel={t("chat.workspaceScope")}

        icon="⊞"

      />



      <DirectoryBrowserDialog
        open={dialogOpen}
        {...(profileWorkspace ? { initialPath: profileWorkspace } : {})}
        onClose={() => setDialogOpen(false)}
        onSelect={handleDirectorySelect}
      />

    </>

  );

}



import { createContext, useContext, type ReactNode } from "react";

export type TranslateFn = (key: string) => string;

const passthrough: TranslateFn = key => key;

const WorkbenchI18nContext = createContext<TranslateFn>(passthrough);

export function WorkbenchI18nProvider({
  translate,
  children,
}: {
  translate: TranslateFn;
  children: ReactNode;
}) {
  return <WorkbenchI18nContext.Provider value={translate}>{children}</WorkbenchI18nContext.Provider>;
}

export function useWorkbenchT(): TranslateFn {
  return useContext(WorkbenchI18nContext);
}

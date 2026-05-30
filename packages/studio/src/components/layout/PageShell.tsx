import type { ReactNode } from "react";
import styles from "./PageShell.module.css";

export type PageShellVariant = "workbench" | "content" | "chat";

export function PageShell({
  children,
  variant = "workbench",
}: {
  children: ReactNode;
  variant?: PageShellVariant;
}) {
  return <div className={`${styles.shell} ${styles[variant]}`}>{children}</div>;
}

import { NavLink } from "react-router-dom";
import styles from "./Sidebar.module.css";

export interface SidebarNavCounts {
  run: number;
  /** Active (running/cancelling) runs; highlights Run badge when > 0. */
  runActive?: number;
  models: number;
  agents: number;
  org: number;
  observe: number;
  observePending?: number;
  /** Gateway health for System nav indicator. */
  systemOnline?: boolean;
}

export interface SidebarProps {
  counts: SidebarNavCounts;
  onNavigate?: () => void;
}

const NAV_ITEMS = [
  { to: "/run", label: "Run", countKey: "run" as const },
  { to: "/models", label: "Models", countKey: "models" as const },
  { to: "/agents", label: "Agents", countKey: "agents" as const },
  { to: "/org", label: "Org", countKey: "org" as const },
  { to: "/observe", label: "Observe", countKey: "observe" as const },
  { to: "/system", label: "System", countKey: "system" as const },
];

export function Sidebar({ counts, onNavigate }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <h1 className={styles.brandTitle}>Dragon</h1>
        <p className={styles.brandSub}>Gateway</p>
      </div>
      <nav className={styles.nav} aria-label="Dashboard views">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem
            }
            onClick={onNavigate}
          >
            <span>{item.label}</span>
            {item.countKey === "system" ? (
              <span
                className={
                  counts.systemOnline === true
                    ? `${styles.statusDot} ${styles.statusOnline}`
                    : counts.systemOnline === false
                      ? `${styles.statusDot} ${styles.statusOffline}`
                      : `${styles.statusDot} ${styles.statusUnknown}`
                }
                aria-label={
                  counts.systemOnline === true
                    ? "Gateway online"
                    : counts.systemOnline === false
                      ? "Gateway offline"
                      : "Gateway status unknown"
                }
              />
            ) : item.countKey === "run" ? (
              <span
                className={
                  (counts.runActive ?? 0) > 0
                    ? `${styles.count} ${styles.countActive}`
                    : styles.count
                }
              >
                {(counts.runActive ?? 0) > 0 ? counts.runActive : counts.run}
              </span>
            ) : item.countKey === "observe" ? (
              <span
                className={
                  (counts.observePending ?? 0) > 0
                    ? `${styles.count} ${styles.countActive}`
                    : styles.count
                }
              >
                {(counts.observePending ?? 0) > 0 ? counts.observePending : counts.observe}
              </span>
            ) : item.countKey !== null ? (
              <span className={styles.count}>{counts[item.countKey]}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

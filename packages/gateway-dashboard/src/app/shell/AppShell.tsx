import { useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuthGate } from "../auth/useAuthGate.js";
import { AuthBanner, Topbar } from "../components/index.js";
import { useDragonEvents } from "../events/EventsContext.js";
import { Sidebar, type SidebarNavCounts } from "./Sidebar.js";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  navCounts?: Partial<SidebarNavCounts>;
  onThemeCycle: () => void;
  themeLabel: string;
}

const defaultCounts: SidebarNavCounts = {
  run: 0,
  models: 0,
  agents: 0,
  org: 0,
  observe: 0,
};

export function AppShell({ navCounts, onThemeCycle, themeLabel }: AppShellProps) {
  const auth = useAuthGate();
  const { sseStatus } = useDragonEvents();
  const [navOpen, setNavOpen] = useState(false);
  const counts = { ...defaultCounts, ...navCounts };

  return (
    <div className={navOpen ? `${styles.shell} ${styles.navOpen}` : styles.shell} data-ui="v2">
      <div className={styles.sidebarSlot}>
        <Sidebar counts={counts} onNavigate={() => setNavOpen(false)} />
      </div>
      <div className={styles.mainColumn}>
        <Topbar
          healthLabel={auth.healthLabel}
          healthOk={auth.healthOk}
          healthChecking={auth.checking}
          sseStatus={sseStatus}
          onThemeClick={onThemeCycle}
          themeLabel={themeLabel}
          onMenuClick={() => setNavOpen(open => !open)}
        />
        <AuthBanner visible={auth.authRequired} />
        <div className={styles.content}>
          <Outlet />
        </div>
      </div>
      {navOpen ? (
        <button
          type="button"
          className={styles.backdrop}
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
    </div>
  );
}

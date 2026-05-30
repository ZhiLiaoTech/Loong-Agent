import { useCallback, useEffect, useState } from "react";
import { LoongBrandMark } from "../brand/LoongBrandMark.js";
import { SidebarNavIcon, type SidebarIconName } from "./SidebarIcons.js";

export type { SidebarIconName };

export interface SidebarItem {
  id: string;
  label: string;
  icon?: SidebarIconName;
}

export type SidebarStatusTone = "online" | "starting" | "offline";

export interface SidebarStatus {
  label: string;
  tone: SidebarStatusTone;
  gatewayUrl?: string;
}

export interface SidebarProps {
  items: readonly SidebarItem[];
  activeId: string;
  productName?: string;
  footerItem?: SidebarItem;
  status?: SidebarStatus;
  onSelect: (id: string) => void;
  storageKey?: string;
  collapseLabel?: string;
  expandLabel?: string;
}

const DEFAULT_STORAGE_KEY = "loong.sidebar.collapsed";

function readCollapsed(storageKey: string): boolean {
  try {
    return globalThis.localStorage?.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function SidebarNavButton({
  item,
  active,
  collapsed,
  onSelect,
}: {
  item: SidebarItem;
  active: boolean;
  collapsed: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`loong-sidebar-item${active ? " loong-sidebar-item--active" : ""}`}
      onClick={() => onSelect(item.id)}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
    >
      {item.icon ? (
        <span className="loong-sidebar-item-icon" aria-hidden>
          <SidebarNavIcon name={item.icon} />
        </span>
      ) : null}
      <span className="loong-sidebar-item-label">{item.label}</span>
    </button>
  );
}

export function Sidebar({
  items,
  activeId,
  productName = "Loong",
  footerItem,
  status,
  onSelect,
  storageKey = DEFAULT_STORAGE_KEY,
  collapseLabel = "Collapse sidebar",
  expandLabel = "Expand sidebar",
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(storageKey));

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(storageKey, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [collapsed, storageKey]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed(current => !current);
  }, []);

  return (
    <aside className={`loong-sidebar${collapsed ? " loong-sidebar--collapsed" : ""}`}>
      <div className="loong-sidebar-header">
        <div className="loong-sidebar-brand" title={productName} aria-label={productName}>
          <LoongBrandMark size={collapsed ? 22 : 26} />
        </div>
        <button
          type="button"
          className="loong-sidebar-toggle"
          onClick={toggleCollapsed}
          aria-label={collapsed ? expandLabel : collapseLabel}
          title={collapsed ? expandLabel : collapseLabel}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>
      <nav className="loong-sidebar-nav" aria-label="Main">
        {items.map(item => (
          <SidebarNavButton
            key={item.id}
            item={item}
            active={item.id === activeId}
            collapsed={collapsed}
            onSelect={onSelect}
          />
        ))}
      </nav>
      {footerItem ? (
        <div className="loong-sidebar-footer-nav">
          <SidebarNavButton
            item={footerItem}
            active={footerItem.id === activeId}
            collapsed={collapsed}
            onSelect={onSelect}
          />
        </div>
      ) : null}
      {status ? (
        <footer className="loong-sidebar-footer">
          <div className="loong-sidebar-status" title={status.label}>
            <span
              className={`loong-sidebar-status-dot loong-sidebar-status-dot--${status.tone}`}
              aria-hidden
            />
            <div className="loong-sidebar-status-copy">
              <div className="loong-sidebar-status-label">{status.label}</div>
              {status.gatewayUrl ? (
                <div className="loong-sidebar-status-url">{status.gatewayUrl}</div>
              ) : null}
            </div>
          </div>
        </footer>
      ) : null}
    </aside>
  );
}

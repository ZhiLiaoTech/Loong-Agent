import { theme } from "../tokens.js";

export interface SidebarItem {
  id: string;
  label: string;
  icon?: string;
}

export interface SidebarProps {
  items: readonly SidebarItem[];
  activeId: string;
  productName?: string;
  onSelect: (id: string) => void;
}

export function Sidebar({ items, activeId, productName = "Loong", onSelect }: SidebarProps) {
  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        background: theme.surface1,
        borderRight: `1px solid ${theme.border}`,
        padding: "12px 10px",
        gap: 4,
      }}
    >
      <div
        style={{
          padding: "8px 10px 16px",
          fontWeight: 700,
          fontSize: 18,
          letterSpacing: 0.3,
          color: theme.text,
        }}
      >
        {productName}
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {items.map(item => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background: active ? theme.accentGlow : "transparent",
                color: active ? theme.accentLight : theme.textSecondary,
                fontWeight: active ? 600 : 400,
              }}
            >
              {item.icon ? <span aria-hidden>{item.icon}</span> : null}
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

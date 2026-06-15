export type SidebarIconName =
  | "chat"
  | "models"
  | "org"
  | "observe"
  | "connections"
  | "agents"
  | "settings"
  | "about";

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function SidebarNavIcon({ name }: { name: SidebarIconName }) {
  switch (name) {
    case "chat":
      return (
        <svg {...ICON_PROPS} aria-hidden>
          <path d="M12 20.5c4.1 0 7.5-2.9 7.5-6.5S16.1 7.5 12 7.5 4.5 10.4 4.5 14s3.4 6.5 7.5 6.5Z" />
          <path d="M8.5 13.5h7" />
          <path d="M8.5 10.5h4.5" />
          <path d="M8 20.5 5.5 21.8v-2.8" />
        </svg>
      );
    case "models":
      return (
        <svg {...ICON_PROPS} aria-hidden>
          <path d="M12 3.5 19.5 7.5 12 11.5 4.5 7.5 12 3.5Z" />
          <path d="M4.5 12 12 16l7.5-4" />
          <path d="M4.5 16 12 19.5l7.5-3.5" />
        </svg>
      );
    case "org":
      return (
        <svg {...ICON_PROPS} aria-hidden>
          <path d="M3 21h18" />
          <path d="M5 21V7l7-4 7 4v14" />
          <path d="M9 21v-6h6v6" />
        </svg>
      );
    case "observe":
      return (
        <svg {...ICON_PROPS} aria-hidden>
          <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7S2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "connections":
      return (
        <svg {...ICON_PROPS} aria-hidden>
          <path d="M8 12h8" />
          <path d="M12 8v8" />
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="8.5" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "agents":
      return (
        <svg {...ICON_PROPS} aria-hidden>
          <circle cx="12" cy="8.5" r="3.25" />
          <path d="M5.5 19.5v-.8a5 5 0 0 1 13 0v.8" />
        </svg>
      );
    case "settings":
      return (
        <svg {...ICON_PROPS} aria-hidden>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "about":
      return (
        <svg {...ICON_PROPS} aria-hidden>
          <circle cx="12" cy="12" r="8.25" />
          <path d="M12 10.2v5.3" />
          <circle cx="12" cy="7.4" r="0.9" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}

import { theme } from "@dragon/ui";
import { useLoongClient } from "../context/LoongClientContext.js";

export function AuthBanner({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }
  return (
    <div
      style={{
        padding: "10px 16px",
        background: theme.accentGlow,
        borderBottom: `1px solid ${theme.border}`,
        color: theme.textSecondary,
        fontSize: 13,
      }}
      role="status"
    >
      Authentication required. Set the Gateway shared secret in Settings (saved for this browser tab).
    </div>
  );
}

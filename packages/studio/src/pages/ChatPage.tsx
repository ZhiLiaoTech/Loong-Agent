import { ChatShell } from "../components/chat/ChatShell.js";
import { PageShell } from "../components/layout/PageShell.js";

export function ChatPage() {
  return (
    <PageShell variant="chat">
      <ChatShell />
    </PageShell>
  );
}

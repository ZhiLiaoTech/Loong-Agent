import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { GatewayEventEnvelope, SseConnectionStatus } from "../../api/index.js";
import { useGatewayClient } from "../auth/useGatewayClient.js";

const MAX_EVENTS = 80;

export interface EventsContextValue {
  sseStatus: SseConnectionStatus;
  events: readonly GatewayEventEnvelope[];
  /** Increments when SSE reconnects; reset event sequence cursors in consumers. */
  connectionEpoch: number;
  reconnect: () => void;
}

const EventsContext = createContext<EventsContextValue | null>(null);

export function EventsProvider({ children }: { children: ReactNode }) {
  const client = useGatewayClient();
  const [sseStatus, setSseStatus] = useState<SseConnectionStatus>("disconnected");
  const [events, setEvents] = useState<readonly GatewayEventEnvelope[]>([]);
  const [connectionKey, setConnectionKey] = useState(0);

  const reconnect = useCallback(() => {
    setEvents([]);
    setConnectionKey(key => key + 1);
  }, []);

  useEffect(() => {
    const handle = client.openEvents({
      onEvent: envelope => {
        setEvents(current => [envelope, ...current].slice(0, MAX_EVENTS));
      },
      onStatus: setSseStatus,
    });
    return () => handle.close();
  }, [client, connectionKey]);

  const value = useMemo(
    () => ({ sseStatus, events, connectionEpoch: connectionKey, reconnect }),
    [sseStatus, events, connectionKey, reconnect],
  );

  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

export function useDragonEvents(): EventsContextValue {
  const context = useContext(EventsContext);
  if (!context) {
    throw new Error("useDragonEvents must be used within EventsProvider.");
  }
  return context;
}

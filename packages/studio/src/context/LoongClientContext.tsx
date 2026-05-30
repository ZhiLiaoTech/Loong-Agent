import { createLoongClient, type LoongClient } from "@loong/client";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useHost } from "./HostContext.js";

const GATEWAY_SECRET_STORAGE_KEY = "loong.gateway.secret";

function readStoredSecret(): string {
  try {
    return globalThis.sessionStorage?.getItem(GATEWAY_SECRET_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

function writeStoredSecret(value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) {
      globalThis.sessionStorage?.setItem(GATEWAY_SECRET_STORAGE_KEY, trimmed);
    } else {
      globalThis.sessionStorage?.removeItem(GATEWAY_SECRET_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

interface LoongClientContextValue {
  client: LoongClient;
  secret: string;
  setSecret: (value: string) => void;
}

const LoongClientContext = createContext<LoongClientContextValue | null>(null);

export function LoongClientProvider({ children }: { children: ReactNode }) {
  const host = useHost();
  const [secret, setSecretState] = useState(() => readStoredSecret());

  const setSecret = useCallback((value: string) => {
    setSecretState(value);
    writeStoredSecret(value);
  }, []);

  const client = useMemo(
    () =>
      createLoongClient({
        host,
        getSecret: () => secret.trim(),
      }),
    [host, secret],
  );

  const value = useMemo(
    () => ({ client, secret, setSecret }),
    [client, secret, setSecret],
  );

  return (
    <LoongClientContext.Provider value={value}>{children}</LoongClientContext.Provider>
  );
}

export function useLoongClient(): LoongClientContextValue {
  const context = useContext(LoongClientContext);
  if (!context) {
    throw new Error("useLoongClient must be used within LoongClientProvider.");
  }
  return context;
}

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { readStoredGatewaySecret, writeStoredGatewaySecret } from "./gatewaySecretStorage.js";

export interface SecretContextValue {
  secret: string;
  setSecret: (value: string) => void;
  getSecret: () => string;
}

const SecretContext = createContext<SecretContextValue | null>(null);

export function SecretProvider({ children }: { children: ReactNode }) {
  const [secret, setSecretState] = useState(() => readStoredGatewaySecret());

  const setSecret = useCallback((value: string) => {
    setSecretState(value);
    writeStoredGatewaySecret(value);
  }, []);

  const getSecret = useCallback(() => secret.trim(), [secret]);

  const value = useMemo(
    () => ({ secret, setSecret, getSecret }),
    [secret, setSecret, getSecret],
  );

  return <SecretContext.Provider value={value}>{children}</SecretContext.Provider>;
}

/** Returns null when SecretProvider is absent (e.g. Loong Studio with injected gateway client). */
export function useOptionalSecret(): SecretContextValue | null {
  return useContext(SecretContext);
}

export function useSecret(): SecretContextValue {
  const context = useOptionalSecret();
  if (!context) {
    throw new Error("useSecret must be used within SecretProvider.");
  }
  return context;
}

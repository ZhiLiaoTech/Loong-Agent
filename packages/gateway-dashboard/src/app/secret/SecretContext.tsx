import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface SecretContextValue {
  secret: string;
  setSecret: (value: string) => void;
  getSecret: () => string;
}

const SecretContext = createContext<SecretContextValue | null>(null);

export function SecretProvider({ children }: { children: ReactNode }) {
  const [secret, setSecretState] = useState("");

  const setSecret = useCallback((value: string) => {
    setSecretState(value);
  }, []);

  const getSecret = useCallback(() => secret.trim(), [secret]);

  const value = useMemo(
    () => ({ secret, setSecret, getSecret }),
    [secret, setSecret, getSecret],
  );

  return <SecretContext.Provider value={value}>{children}</SecretContext.Provider>;
}

export function useSecret(): SecretContextValue {
  const context = useContext(SecretContext);
  if (!context) {
    throw new Error("useSecret must be used within SecretProvider.");
  }
  return context;
}

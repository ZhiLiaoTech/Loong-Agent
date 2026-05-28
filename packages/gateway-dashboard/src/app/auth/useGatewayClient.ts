import { useCallback, useMemo } from "react";
import { createGatewayClient, type GatewayClient } from "../../api/index.js";
import { useInjectedGatewayClient } from "./GatewayClientContext.js";
import { useOptionalSecret } from "../secret/SecretContext.js";

export function useGatewayClient(): GatewayClient {
  const injected = useInjectedGatewayClient();
  const secretCtx = useOptionalSecret();
  const getSecret = useCallback(() => secretCtx?.getSecret() ?? "", [secretCtx]);

  const local = useMemo(() => createGatewayClient({ getSecret }), [getSecret]);

  return injected ?? local;
}

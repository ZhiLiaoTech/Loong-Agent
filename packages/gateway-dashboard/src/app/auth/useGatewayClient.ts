import { useMemo } from "react";
import { createGatewayClient, type GatewayClient } from "../../api/client.js";
import { useSecret } from "../secret/SecretContext.js";

export function useGatewayClient(): GatewayClient {
  const { getSecret } = useSecret();
  return useMemo(() => createGatewayClient({ getSecret }), [getSecret]);
}

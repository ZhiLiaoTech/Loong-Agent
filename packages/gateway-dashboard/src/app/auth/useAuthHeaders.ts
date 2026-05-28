import { buildAuthHeaders } from "../../api/index.js";
import { useSecret } from "../secret/SecretContext.js";

export function useAuthHeaders(json = false): HeadersInit {
  const { getSecret } = useSecret();
  return buildAuthHeaders(getSecret, json);
}

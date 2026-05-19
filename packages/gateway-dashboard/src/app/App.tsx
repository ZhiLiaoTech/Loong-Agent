import { AppRoutes } from "./routing/AppRoutes.js";
import { SecretProvider } from "./secret/SecretContext.js";

export function App() {
  return (
    <SecretProvider>
      <AppRoutes />
    </SecretProvider>
  );
}

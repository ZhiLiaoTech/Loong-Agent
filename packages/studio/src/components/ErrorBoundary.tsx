import { Component, type ErrorInfo, type ReactNode } from "react";
import { theme } from "@dragon/ui";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Loong Studio]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            color: theme.text,
            background: theme.bg,
            minHeight: "100vh",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ color: theme.error }}>Something went wrong</h1>
          <pre
            style={{
              marginTop: 16,
              padding: 16,
              background: theme.surface2,
              borderRadius: 8,
              overflow: "auto",
              color: theme.textSecondary,
              whiteSpace: "pre-wrap",
            }}
          >
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

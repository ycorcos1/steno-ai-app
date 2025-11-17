import {
  Component,
  ErrorInfo,
  ReactNode,
} from "react";

interface CollaborationErrorBoundaryProps {
  children: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface CollaborationErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class CollaborationErrorBoundary extends Component<
  CollaborationErrorBoundaryProps,
  CollaborationErrorBoundaryState
> {
  constructor(props: CollaborationErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("Collaboration error boundary caught:", error, info);
    }
    this.props.onError?.(error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px",
            textAlign: "center",
            background: "rgba(15, 23, 42, 0.95)",
          }}
        >
          <div
            style={{
              borderRadius: "20px",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              background: "rgba(127, 29, 29, 0.7)",
              padding: "32px",
              maxWidth: "480px",
              color: "rgba(254, 226, 226, 0.95)",
            }}
          >
            <h2 style={{ fontSize: "20px", marginBottom: "12px" }}>
              Collaboration Error
            </h2>
            <p style={{ fontSize: "14px", marginBottom: "24px" }}>
              Something went wrong with real-time collaboration. Your work is
              safe, but we need to reload the page to continue.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                padding: "10px 18px",
                borderRadius: "12px",
                border: "1px solid rgba(254, 226, 226, 0.5)",
                background: "rgba(239, 68, 68, 0.2)",
                color: "rgba(254, 226, 226, 0.95)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload page
            </button>
            {import.meta.env.DEV && this.state.error && (
              <details
                style={{
                  marginTop: "20px",
                  textAlign: "left",
                  fontSize: "12px",
                  opacity: 0.85,
                }}
              >
                <summary>Details (dev only)</summary>
                <pre
                  style={{
                    marginTop: "12px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    background: "rgba(0, 0, 0, 0.2)",
                    padding: "12px",
                    borderRadius: "12px",
                  }}
                >
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}


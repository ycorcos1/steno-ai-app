import { useEffect, useState } from "react";

type ConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "reconnecting"
  | "failed"
  | "error";

interface ConnectionStatusBadgeProps {
  status: ConnectionState;
  reconnectAttempt?: number;
  maxAttempts?: number;
  reconnectDelay?: number | null;
  latency?: number | null;
  onRetry?: () => void;
}

export function ConnectionStatusBadge({
  status,
  reconnectAttempt = 0,
  maxAttempts = 5,
  reconnectDelay,
  latency,
  onRetry,
}: ConnectionStatusBadgeProps) {
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (status === "reconnecting" && reconnectDelay) {
      setCountdown(Math.ceil(reconnectDelay / 1000));
      const interval = window.setInterval(() => {
        setCountdown((prev) => {
          if (prev === null || prev <= 1) {
            window.clearInterval(interval);
            return null;
          }
          return prev - 1;
        });
      }, 1000);
      return () => window.clearInterval(interval);
    }
    setCountdown(null);
  }, [status, reconnectDelay]);

  const getNetworkQuality = (): "good" | "fair" | "poor" | null => {
    if (latency === null || latency === undefined) {
      return null;
    }
    if (latency < 100) return "good";
    if (latency < 300) return "fair";
    return "poor";
  };

  const networkQuality = getNetworkQuality();

  const config = {
    connected: {
      color: "rgba(16, 185, 129, 0.9)",
      bg: "rgba(16, 185, 129, 0.1)",
      border: "rgba(16, 185, 129, 0.4)",
      text: "Connected",
      icon: "●",
    },
    connecting: {
      color: "rgba(59, 130, 246, 0.9)",
      bg: "rgba(59, 130, 246, 0.1)",
      border: "rgba(59, 130, 246, 0.4)",
      text: "Connecting…",
      icon: "◐",
    },
    disconnected: {
      color: "rgba(148, 163, 184, 0.7)",
      bg: "rgba(148, 163, 184, 0.1)",
      border: "rgba(148, 163, 184, 0.3)",
      text: "Disconnected",
      icon: "○",
    },
    reconnecting: {
      color: "rgba(234, 179, 8, 0.9)",
      bg: "rgba(234, 179, 8, 0.1)",
      border: "rgba(234, 179, 8, 0.4)",
      text:
        countdown !== null
          ? `Reconnecting in ${countdown}s`
          : `Reconnecting (${reconnectAttempt}/${maxAttempts})`,
      icon: "◐",
    },
    failed: {
      color: "rgba(239, 68, 68, 0.9)",
      bg: "rgba(239, 68, 68, 0.1)",
      border: "rgba(239, 68, 68, 0.4)",
      text: "Connection failed",
      icon: "○",
    },
    error: {
      color: "rgba(239, 68, 68, 0.9)",
      bg: "rgba(239, 68, 68, 0.1)",
      border: "rgba(239, 68, 68, 0.4)",
      text: "Error",
      icon: "○",
    },
  } as const;

  const state = config[status] ?? config.disconnected;
  const qualityColors = {
    good: "rgba(16, 185, 129, 0.9)",
    fair: "rgba(234, 179, 8, 0.9)",
    poor: "rgba(239, 68, 68, 0.9)",
  };

  const showRetry = (status === "failed" || status === "error") && onRetry;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
      <div
        role="status"
        aria-live="polite"
        aria-label={`Connection status: ${state.text}`}
        title={
          status === "connected" && latency !== null
            ? `Latency ${latency}ms`
            : state.text
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 12px",
          borderRadius: "999px",
          border: `1px solid ${state.border}`,
          background: state.bg,
          color: state.color,
          fontSize: "12px",
          fontWeight: 600,
        }}
      >
        <span style={{ fontSize: "8px" }} aria-hidden="true">
          {state.icon}
        </span>
        <span>{state.text}</span>
        {status === "connected" && latency !== null && (
          <span style={{ fontSize: "10px", opacity: 0.7 }}>({latency}ms)</span>
        )}
      </div>

      {showRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label="Retry connection"
          title="Retry connection"
          style={{
            padding: "4px 8px",
            borderRadius: "6px",
            border: "1px solid rgba(59, 130, 246, 0.4)",
            background: "rgba(59, 130, 246, 0.1)",
            color: "rgba(59, 130, 246, 0.9)",
            fontSize: "11px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}


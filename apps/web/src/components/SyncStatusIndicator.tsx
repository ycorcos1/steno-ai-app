import { useEffect, useState } from "react";

type SyncStatus = "synced" | "syncing" | "conflict";

interface SyncStatusIndicatorProps {
  status: SyncStatus;
  lastSyncTime?: Date | null;
  onManualSync?: () => void;
  showManualSync?: boolean;
}

export function SyncStatusIndicator({
  status,
  lastSyncTime,
  onManualSync,
  showManualSync = false,
}: SyncStatusIndicatorProps) {
  const [timeAgo, setTimeAgo] = useState<string>("Just now");

  useEffect(() => {
    if (!lastSyncTime) {
      setTimeAgo("Pending…");
      return;
    }

    const updateTimeAgo = () => {
      const now = Date.now();
      const diffMs = now - lastSyncTime.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);

      if (diffSec < 10) {
        setTimeAgo("Just now");
      } else if (diffSec < 60) {
        setTimeAgo(`${diffSec}s ago`);
      } else if (diffMin < 60) {
        setTimeAgo(`${diffMin}m ago`);
      } else {
        setTimeAgo(`${diffHour}h ago`);
      }
    };

    updateTimeAgo();
    const interval = window.setInterval(updateTimeAgo, 10_000);
    return () => clearInterval(interval);
  }, [lastSyncTime]);

  const config = {
    synced: {
      color: "rgba(16, 185, 129, 0.9)",
      bg: "rgba(16, 185, 129, 0.1)",
      border: "rgba(16, 185, 129, 0.4)",
      icon: "✓",
      text: "All changes saved",
      aria: "Document sync status: All changes saved",
    },
    syncing: {
      color: "rgba(234, 179, 8, 0.9)",
      bg: "rgba(234, 179, 8, 0.1)",
      border: "rgba(234, 179, 8, 0.4)",
      icon: "↻",
      text: "Saving changes…",
      aria: "Document sync status: Saving changes",
    },
    conflict: {
      color: "rgba(239, 68, 68, 0.9)",
      bg: "rgba(239, 68, 68, 0.1)",
      border: "rgba(239, 68, 68, 0.4)",
      icon: "⚠",
      text: "Sync conflict detected",
      aria: "Document sync status: Conflict detected",
    },
  } as const;

  const state = config[status];

  return (
    <div
      style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
      aria-live="polite"
    >
      <div
        role="status"
        aria-label={state.aria}
        title={
          lastSyncTime ? `Last saved ${timeAgo}` : "Sync has not completed yet"
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
          cursor: "help",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            fontSize: "10px",
            display: "inline-flex",
            animation: status === "syncing" ? "spin 1s linear infinite" : "none",
          }}
        >
          {state.icon}
        </span>
        <span>{state.text}</span>
        {status === "synced" && lastSyncTime && (
          <span style={{ fontSize: "10px", opacity: 0.7 }}>• {timeAgo}</span>
        )}
      </div>

      {showManualSync && onManualSync && (
        <button
          type="button"
          onClick={onManualSync}
          aria-label="Manually trigger document sync"
          title="Force sync (debug)"
          style={{
            padding: "4px 8px",
            borderRadius: "6px",
            border: "1px solid rgba(148, 163, 184, 0.3)",
            background: "rgba(71, 85, 105, 0.2)",
            color: "rgba(148, 163, 184, 0.9)",
            fontSize: "11px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sync
        </button>
      )}

      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
}


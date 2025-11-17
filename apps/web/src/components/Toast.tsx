import { useEffect, useState } from "react";

export type ToastVariant = "success" | "warning" | "error" | "info";

interface ToastProps {
  message: string;
  variant?: ToastVariant;
  duration?: number | null;
  onDismiss: () => void;
  showDismissButton?: boolean;
}

export function Toast({
  message,
  variant = "success",
  duration = 3000,
  onDismiss,
  showDismissButton = false,
}: ToastProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (duration === null) {
      return;
    }

    const timer = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(onDismiss, 250);
    }, duration);

    return () => window.clearTimeout(timer);
  }, [duration, onDismiss]);

  const variantConfig = {
    success: {
      border: "rgba(16, 185, 129, 0.4)",
      color: "rgba(209, 250, 229, 0.9)",
      icon: "✓",
    },
    warning: {
      border: "rgba(234, 179, 8, 0.4)",
      color: "rgba(254, 249, 195, 0.9)",
      icon: "⚠",
    },
    error: {
      border: "rgba(239, 68, 68, 0.4)",
      color: "rgba(254, 226, 226, 0.9)",
      icon: "✕",
    },
    info: {
      border: "rgba(59, 130, 246, 0.4)",
      color: "rgba(219, 234, 254, 0.9)",
      icon: "ℹ",
    },
  } as const;

  const config = variantConfig[variant];

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        minWidth: "280px",
        maxWidth: "360px",
        padding: "12px 16px",
        borderRadius: "14px",
        border: `1px solid ${config.border}`,
        background:
          "linear-gradient(180deg, rgba(17, 24, 39, 0.98), rgba(17, 24, 39, 0.92))",
        boxShadow:
          "0 25px 45px -30px rgba(15, 23, 42, 0.8), 0 15px 30px -25px rgba(15, 23, 42, 0.7)",
        color: config.color,
        fontSize: "13px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateX(0)" : "translateX(16px)",
        transition: "opacity 0.25s ease, transform 0.25s ease",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: "16px" }}>
        {config.icon}
      </span>
      <span style={{ flex: 1 }}>{message}</span>
      {(showDismissButton || duration === null) && (
        <button
          type="button"
          onClick={() => {
            setVisible(false);
            window.setTimeout(onDismiss, 250);
          }}
          aria-label="Dismiss notification"
          style={{
            border: "none",
            background: "none",
            color: config.color,
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

interface ToastContainerProps {
  toasts: Array<{
    id: string;
    message: string;
    variant?: ToastVariant;
    duration?: number | null;
  }>;
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <>
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          style={{
            position: "fixed",
            top: `${80 + index * 70}px`,
            right: "24px",
            zIndex: 50 - index,
          }}
        >
          <Toast
            message={toast.message}
            variant={toast.variant}
            duration={toast.duration}
            onDismiss={() => onDismiss(toast.id)}
            showDismissButton={toast.duration === null}
          />
        </div>
      ))}
    </>
  );
}

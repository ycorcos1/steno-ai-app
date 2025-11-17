import { useState } from "react";
import type { CSSProperties } from "react";

export type ActiveUser = {
  userId: string;
  userName: string;
  status: "online" | "typing" | "idle";
  joinedAt: number;
};

interface ActiveUsersSidebarProps {
  activeUsers: Map<string, ActiveUser>;
  currentUserId?: string;
  inline?: boolean; // If true, render inline instead of fixed position
}

export function ActiveUsersSidebar({
  activeUsers,
  currentUserId,
  inline = false,
}: ActiveUsersSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const userList = Array.from(activeUsers.values()).filter(
    (user) => user.userId !== currentUserId
  );

  const containerStyle: CSSProperties = inline
    ? {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }
    : {
        position: "fixed",
        top: "96px",
        right: isCollapsed ? "-280px" : "16px",
        width: "280px",
        maxHeight: "calc(100vh - 120px)",
        background:
          "linear-gradient(180deg, rgba(17, 24, 39, 0.95), rgba(17, 24, 39, 0.88))",
        border: "1px solid rgba(148, 163, 184, 0.18)",
        borderRadius: "22px",
        padding: "16px",
        boxShadow:
          "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
        transition: "right 0.3s ease",
        zIndex: 30,
        overflowY: "auto",
      };

  return (
    <div style={containerStyle}>
      {!inline && (
        <button
          type="button"
          onClick={() => setIsCollapsed((prev) => !prev)}
          style={{
            position: "absolute",
            left: "-36px",
            top: "12px",
            width: "36px",
            height: "36px",
            borderRadius: "12px 0 0 12px",
            border: "1px solid rgba(148, 163, 184, 0.18)",
            background: "rgba(17, 24, 39, 0.95)",
            color: "rgba(226, 232, 240, 0.9)",
            cursor: "pointer",
          }}
          aria-label={isCollapsed ? "Show active users" : "Hide active users"}
        >
          {isCollapsed ? "👥" : "→"}
        </button>
      )}

      <div
        style={{
          fontSize: "12px",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "rgba(148, 163, 184, 0.8)",
          marginBottom: "12px",
        }}
      >
        Active Users ({userList.length})
      </div>

      {userList.length === 0 ? (
        <div
          style={{
            fontSize: "13px",
            color: "rgba(148, 163, 184, 0.6)",
            textAlign: "center",
            padding: "12px",
          }}
        >
          You're the only one here.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {userList.map((user) => (
            <div
              key={user.userId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "8px",
                borderRadius: "12px",
                background: "rgba(15, 23, 42, 0.45)",
              }}
            >
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #10b981, #059669)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#052e16",
                }}
              >
                {user.userName.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "rgba(226, 232, 240, 0.9)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {user.userName}
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "rgba(148, 163, 184, 0.7)",
                  }}
                >
                  {user.status === "typing"
                    ? "Typing..."
                    : user.status === "idle"
                    ? "Idle"
                    : "Active"}
                </div>
              </div>
              <div
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  background:
                    user.status === "online"
                      ? "#10b981"
                      : user.status === "typing"
                      ? "#fbbf24"
                      : "rgba(148, 163, 184, 0.6)",
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

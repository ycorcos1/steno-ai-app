import { CSSProperties, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  acceptInvitation,
  declineInvitation,
  getInvitations,
  Invitation,
} from "../lib/api";

const pageStyles: CSSProperties = {
  minHeight: "100vh",
  background: "radial-gradient(circle at top, #1f2937, #0f172a 65%)",
  color: "#e2e8f0",
  padding: "48px 24px",
  fontFamily:
    "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const containerStyles: CSSProperties = {
  maxWidth: "960px",
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const cardStyles: CSSProperties = {
  borderRadius: "22px",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  background:
    "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.78))",
  boxShadow:
    "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
  padding: "24px",
};

const badgeStyles: CSSProperties = {
  borderRadius: "999px",
  border: "1px solid rgba(59, 130, 246, 0.4)",
  background: "rgba(59, 130, 246, 0.15)",
  color: "rgba(191, 219, 254, 0.95)",
  fontSize: "12px",
  padding: "4px 10px",
  fontWeight: 600,
  textTransform: "capitalize",
};

const secondaryButtonStyles: CSSProperties = {
  borderRadius: "12px",
  border: "1px solid rgba(148, 163, 184, 0.4)",
  background: "rgba(15, 23, 42, 0.65)",
  color: "#f8fafc",
  padding: "10px 18px",
  fontWeight: 600,
  cursor: "pointer",
};

const primaryButtonStyles: CSSProperties = {
  borderRadius: "12px",
  border: "none",
  background: "linear-gradient(135deg, #10b981, #059669)",
  color: "#052e16",
  padding: "10px 20px",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 18px 30px -20px rgba(16, 185, 129, 0.55)",
};

const InvitationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingToken, setProcessingToken] = useState<string | null>(null);

  useEffect(() => {
    void loadInvitations();
  }, []);

  const loadInvitations = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getInvitations();
      setInvitations(data);
    } catch (err) {
      setError("Failed to load invitations.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (token: string) => {
    try {
      setProcessingToken(token);
      const result = await acceptInvitation(token);
      navigate(`/documents/${result.documentId}`);
    } catch (err: any) {
      const message =
        err.response?.data?.error ??
        err.response?.data?.message ??
        "Unable to accept invitation.";
      alert(message);
    } finally {
      setProcessingToken(null);
    }
  };

  const handleDecline = async (token: string) => {
    if (!window.confirm("Decline this invitation?")) {
      return;
    }

    try {
      setProcessingToken(token);
      await declineInvitation(token);
      await loadInvitations();
    } catch (err) {
      alert("Failed to decline invitation.");
    } finally {
      setProcessingToken(null);
    }
  };

  return (
    <div style={pageStyles}>
      <div style={containerStyles}>
        <div>
          <h1 style={{ fontSize: "34px", fontWeight: 700, marginBottom: "12px" }}>
            Pending Invitations
          </h1>
          <p style={{ color: "rgba(148, 163, 184, 0.85)", fontSize: "15px" }}>
            Manage collaboration invitations you've received from your team.
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: "16px 20px",
              borderRadius: "16px",
              border: "1px solid rgba(248, 113, 113, 0.4)",
              background: "rgba(127, 29, 29, 0.35)",
              color: "rgba(254, 226, 226, 0.95)",
            }}
          >
            {error}
          </div>
        )}

        {loading ? (
          <p style={{ color: "rgba(148, 163, 184, 0.8)" }}>Loading…</p>
        ) : invitations.length === 0 ? (
          <div
            style={{
              ...cardStyles,
              textAlign: "center",
              padding: "48px 24px",
            }}
          >
            <p style={{ fontSize: "16px", color: "rgba(148, 163, 184, 0.8)" }}>
              No pending invitations right now.
            </p>
            <button
              type="button"
              style={{ ...secondaryButtonStyles, marginTop: "16px" }}
              onClick={() => navigate("/dashboard")}
            >
              Return to dashboard
            </button>
          </div>
        ) : (
          invitations.map((invitation) => (
            <div key={invitation.id} style={cardStyles}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0, fontSize: "22px", fontWeight: 600 }}>
                      {invitation.documentTitle ?? "Untitled document"}
                    </h2>
                    <p
                      style={{
                        margin: "4px 0 0",
                        color: "rgba(148, 163, 184, 0.8)",
                        fontSize: "14px",
                      }}
                    >
                      Invited by {invitation.inviterName ?? "Unknown"} (
                      {invitation.inviterEmail ?? "unknown"})
                    </p>
                  </div>
                  <span style={badgeStyles}>{invitation.role}</span>
                </div>

                <p style={{ margin: 0, color: "rgba(148, 163, 184, 0.8)" }}>
                  Expires{" "}
                  {new Date(invitation.expiresAt).toLocaleDateString(undefined, {
                    dateStyle: "medium",
                  })}
                </p>

                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={{
                      ...primaryButtonStyles,
                      opacity:
                        processingToken && processingToken === invitation.token
                          ? 0.6
                          : 1,
                    }}
                    disabled={
                      !!processingToken && processingToken === invitation.token
                    }
                    onClick={() => handleAccept(invitation.token ?? "")}
                  >
                    {processingToken === invitation.token
                      ? "Accepting…"
                      : "Accept"}
                  </button>
                  <button
                    type="button"
                    style={{
                      ...secondaryButtonStyles,
                      opacity:
                        processingToken && processingToken === invitation.token
                          ? 0.6
                          : 1,
                    }}
                    disabled={
                      !!processingToken && processingToken === invitation.token
                    }
                    onClick={() => handleDecline(invitation.token ?? "")}
                  >
                    {processingToken === invitation.token
                      ? "Declining…"
                      : "Decline"}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default InvitationsPage;


import { CSSProperties, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  acceptInvitation,
  declineInvitation,
  getInvitationByToken,
  Invitation,
} from "../lib/api";
import { useAuth } from "../lib/auth";

const pageStyles: CSSProperties = {
  minHeight: "100vh",
  background: "radial-gradient(circle at top, #111827, #030712 70%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "40px 16px",
  color: "#e2e8f0",
  fontFamily:
    "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const InvitationAcceptPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading, logout } = useAuth();

  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Invalid invitation link.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchInvitation = async () => {
      try {
        setLoading(true);
        const data = await getInvitationByToken(token);
        if (!cancelled) {
          setInvitation(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          const message =
            err.response?.data?.error ??
            err.response?.data?.message ??
            "This invitation could not be loaded.";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchInvitation();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAccept = async () => {
    if (!token) {
      return;
    }
    try {
      setProcessing(true);
      const result = await acceptInvitation(token);
      navigate(`/documents/${result.documentId}`, { replace: true });
    } catch (err: any) {
      const message =
        err.response?.data?.error ??
        err.response?.data?.message ??
        "Unable to accept invitation.";
      setError(message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (!token) {
      return;
    }
    if (!window.confirm("Decline this invitation?")) {
      return;
    }

    try {
      setProcessing(true);
      await declineInvitation(token);
      setError(null);
      setInvitation(null);
      alert("Invitation declined.");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError("Failed to decline invitation.");
    } finally {
      setProcessing(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate(0);
  };

  const cardStyles: CSSProperties = {
    width: "100%",
    maxWidth: "500px",
    borderRadius: "24px",
    border: "1px solid rgba(148, 163, 184, 0.2)",
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.84))",
    boxShadow:
      "0 35px 60px -35px rgba(15, 23, 42, 0.9), 0 20px 40px -30px rgba(15, 23, 42, 0.8)",
    padding: "32px",
  };

  if (loading || authLoading) {
    return (
      <div style={pageStyles}>
        <div style={cardStyles}>
          <p style={{ color: "rgba(148, 163, 184, 0.8)" }}>
            Loading invitation…
          </p>
        </div>
      </div>
    );
  }

  if (error || !invitation) {
    return (
      <div style={pageStyles}>
        <div style={cardStyles}>
          <h1 style={{ fontSize: "24px", marginBottom: "16px" }}>
            Invitation Unavailable
          </h1>
          <p style={{ color: "rgba(248, 113, 113, 0.9)", marginBottom: "24px" }}>
            {error ?? "This invitation is no longer valid."}
          </p>
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            style={{
              borderRadius: "12px",
              border: "1px solid rgba(148, 163, 184, 0.4)",
              background: "rgba(15, 23, 42, 0.65)",
              color: "#f8fafc",
              padding: "10px 20px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyles}>
      <div style={cardStyles}>
        <p style={{ fontSize: "13px", color: "rgba(148, 163, 184, 0.75)" }}>
          Invitation to collaborate
        </p>
        <h1 style={{ fontSize: "28px", margin: "8px 0 16px" }}>
          {invitation.documentTitle ?? "Untitled document"}
        </h1>

        <div style={{ marginBottom: "24px" }}>
          <p style={{ margin: "0 0 8px", color: "rgba(148, 163, 184, 0.8)" }}>
            Invited by
          </p>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {invitation.inviterName ?? "Unknown collaborator"}
          </p>
          <p style={{ margin: "4px 0 0", color: "rgba(148, 163, 184, 0.65)" }}>
            {invitation.inviterEmail ?? "No email provided"}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            marginBottom: "24px",
          }}
        >
          <span
            style={{
              borderRadius: "999px",
              border: "1px solid rgba(16, 185, 129, 0.4)",
              background: "rgba(16, 185, 129, 0.15)",
              color: "rgba(167, 243, 208, 0.95)",
              padding: "4px 10px",
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "capitalize",
            }}
          >
            {invitation.role}
          </span>
          <span
            style={{
              borderRadius: "999px",
              border: "1px solid rgba(148, 163, 184, 0.4)",
              background: "rgba(148, 163, 184, 0.1)",
              color: "rgba(226, 232, 240, 0.9)",
              padding: "4px 10px",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            Expires{" "}
            {new Date(invitation.expiresAt).toLocaleDateString(undefined, {
              dateStyle: "medium",
            })}
          </span>
        </div>

        {!user ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              marginBottom: "16px",
            }}
          >
            <button
              type="button"
              onClick={() => navigate("/login")}
              style={{
                borderRadius: "12px",
                border: "none",
                background: "rgba(59, 130, 246, 0.85)",
                color: "#fff",
                padding: "10px 16px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Log in to accept
            </button>
            <button
              type="button"
              onClick={() => navigate("/signup")}
              style={{
                borderRadius: "12px",
                border: "1px solid rgba(148, 163, 184, 0.4)",
                background: "transparent",
                color: "#e2e8f0",
                padding: "10px 16px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Create an account
            </button>
          </div>
        ) : invitation.inviteeEmail.toLowerCase() !==
            user.email.toLowerCase() ? (
          <div
            style={{
              marginBottom: "16px",
              padding: "12px 16px",
              borderRadius: "14px",
              border: "1px solid rgba(251, 191, 36, 0.4)",
              background: "rgba(120, 53, 15, 0.35)",
              color: "rgba(254, 243, 199, 0.95)",
              fontSize: "14px",
            }}
          >
            <p style={{ margin: "0 0 8px" }}>
              This invitation was sent to <strong>{invitation.inviteeEmail}</strong>.
              You are currently logged in as <strong>{user.email}</strong>.
            </p>
            <button
              type="button"
              onClick={handleLogout}
              style={{
                border: "none",
                background: "transparent",
                color: "rgba(96, 165, 250, 0.95)",
                textDecoration: "underline",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              Log out and switch accounts
            </button>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleAccept}
            disabled={processing || !user}
            style={{
              borderRadius: "12px",
              border: "none",
              background: "linear-gradient(135deg, #10b981, #059669)",
              color: "#052e16",
              padding: "10px 20px",
              fontWeight: 700,
              cursor: processing || !user ? "not-allowed" : "pointer",
              opacity: processing || !user ? 0.6 : 1,
            }}
          >
            {processing ? "Accepting…" : "Accept invitation"}
          </button>
          <button
            type="button"
            onClick={handleDecline}
            disabled={processing}
            style={{
              borderRadius: "12px",
              border: "1px solid rgba(148, 163, 184, 0.35)",
              background: "transparent",
              color: "#e2e8f0",
              padding: "10px 20px",
              fontWeight: 600,
              cursor: processing ? "not-allowed" : "pointer",
              opacity: processing ? 0.6 : 1,
            }}
          >
            {processing ? "Declining…" : "Decline"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InvitationAcceptPage;


import { useEffect, useMemo, useState } from "react";
import {
  cancelInvitation,
  Collaborator,
  createInvitation,
  getCollaborators,
  getInvitationsByDocument,
  Invitation,
  InvitationRole,
  removeCollaborator,
  resendInvitation,
  updateCollaboratorRole,
} from "../lib/api";

interface ShareModalProps {
  documentId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ShareModal({ documentId, isOpen, onClose }: ShareModalProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationRole>("editor");
  const [invitationLink, setInvitationLink] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      if (!isOpen) {
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const [collabList, inviteList] = await Promise.all([
          getCollaborators(documentId),
          getInvitationsByDocument(documentId),
        ]);
        if (!cancelled) {
          setCollaborators(collabList);
          setInvitations(inviteList);
        }
      } catch (err) {
        if (!cancelled) {
          setError("Failed to load collaborators and invitations.");
          console.error(err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, [documentId, isOpen]);

  const pendingInvitations = useMemo(
    () => invitations.filter((inv) => inv.status === "pending"),
    [invitations]
  );

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) {
      setError("Please enter an email address.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    setInvitationLink(null);

    try {
      const result = await createInvitation(documentId, email.trim(), role);
      const link = `${window.location.origin}/invitations/accept/${result.token}`;
      setInvitationLink(link);
      setSuccess(`Invitation sent to ${email.trim()}`);
      setEmail("");
      await refreshData();
    } catch (err: any) {
      const message =
        err.response?.data?.error ??
        err.response?.data?.message ??
        "Failed to send invitation.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const refreshData = async () => {
    try {
      const [collabList, inviteList] = await Promise.all([
        getCollaborators(documentId),
        getInvitationsByDocument(documentId),
      ]);
      setCollaborators(collabList);
      setInvitations(inviteList);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemoveCollaborator = async (userId: string, name: string) => {
    if (!window.confirm(`Remove ${name} from this document?`)) {
      return;
    }

    try {
      await removeCollaborator(documentId, userId);
      setSuccess(`${name} removed from document.`);
      await refreshData();
    } catch (err) {
      setError("Failed to remove collaborator.");
    }
  };

  const handleChangeRole = async (userId: string, nextRole: InvitationRole) => {
    try {
      await updateCollaboratorRole(documentId, userId, nextRole);
      setSuccess("Collaborator role updated.");
      await refreshData();
    } catch (err) {
      setError("Failed to update collaborator role.");
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    try {
      const result = await resendInvitation(documentId, invitationId);
      const link = `${window.location.origin}/invitations/accept/${result.token}`;
      setInvitationLink(link);
      setSuccess("Invitation link refreshed.");
      await refreshData();
    } catch (err) {
      setError("Failed to resend invitation.");
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    if (!window.confirm("Cancel this invitation?")) {
      return;
    }

    try {
      await cancelInvitation(documentId, invitationId);
      setSuccess("Invitation cancelled.");
      await refreshData();
    } catch (err) {
      setError("Failed to cancel invitation.");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {
      setError("Failed to copy link to clipboard.");
    });
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2, 6, 23, 0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "720px",
          maxHeight: "90vh",
          overflowY: "auto",
          background:
            "linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.93))",
          borderRadius: "24px",
          border: "1px solid rgba(148, 163, 184, 0.25)",
          boxShadow:
            "0 35px 65px -35px rgba(15, 23, 42, 0.95), 0 20px 45px -30px rgba(15, 23, 42, 0.85)",
          padding: "32px",
          color: "#e2e8f0",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "16px",
          }}
        >
          <div>
            <h2
              id="share-modal-title"
              style={{ fontSize: "28px", fontWeight: 700, margin: 0 }}
            >
              Share Document
            </h2>
            <p style={{ marginTop: "8px", color: "rgba(148, 163, 184, 0.8)" }}>
              Invite collaborators, manage pending invitations, or adjust current
              access.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              color: "rgba(148, 163, 184, 0.9)",
              fontSize: "18px",
              cursor: "pointer",
            }}
            aria-label="Close share modal"
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px 16px",
              borderRadius: "14px",
              border: "1px solid rgba(248, 113, 113, 0.45)",
              background: "rgba(127, 29, 29, 0.35)",
              color: "rgba(254, 226, 226, 0.95)",
              fontSize: "14px",
            }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px 16px",
              borderRadius: "14px",
              border: "1px solid rgba(16, 185, 129, 0.35)",
              background: "rgba(6, 78, 59, 0.35)",
              color: "rgba(167, 243, 208, 0.95)",
              fontSize: "14px",
            }}
          >
            {success}
          </div>
        )}

        {invitationLink && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px 16px",
              borderRadius: "14px",
              border: "1px solid rgba(59, 130, 246, 0.35)",
              background: "rgba(30, 64, 175, 0.35)",
            }}
          >
            <p
              style={{
                margin: "0 0 8px",
                fontSize: "13px",
                color: "rgba(191, 219, 254, 0.9)",
              }}
            >
              Invitation link (share manually):
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={invitationLink}
                readOnly
                style={{
                  flex: 1,
                  borderRadius: "10px",
                  border: "1px solid rgba(59, 130, 246, 0.35)",
                  background: "rgba(15, 23, 42, 0.7)",
                  color: "#e2e8f0",
                  padding: "8px 12px",
                  fontSize: "13px",
                }}
              />
              <button
                type="button"
                onClick={() => copyToClipboard(invitationLink)}
                style={{
                  borderRadius: "10px",
                  border: "none",
                  background: "rgba(59, 130, 246, 0.9)",
                  color: "#fff",
                  padding: "8px 16px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Copy
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleInvite} style={{ marginTop: "24px" }}>
          <div
            style={{
              background: "rgba(15, 23, 42, 0.7)",
              borderRadius: "16px",
              padding: "20px",
              border: "1px solid rgba(148, 163, 184, 0.2)",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <label style={{ fontSize: "13px", fontWeight: 500 }}>
                Invite by email
              </label>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <input
                  type="email"
                  placeholder="collaborator@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  style={{
                    borderRadius: "12px",
                    border: "1px solid rgba(148, 163, 184, 0.35)",
                    padding: "12px",
                    background: "rgba(15, 23, 42, 0.9)",
                    color: "#e2e8f0",
                    fontSize: "14px",
                  }}
                  disabled={submitting}
                />
                <select
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as InvitationRole)
                  }
                  style={{
                    borderRadius: "12px",
                    border: "1px solid rgba(148, 163, 184, 0.35)",
                    padding: "10px 12px",
                    background: "rgba(15, 23, 42, 0.9)",
                    color: "#e2e8f0",
                    fontSize: "14px",
                  }}
                  disabled={submitting}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    alignSelf: "flex-start",
                    borderRadius: "10px",
                    border: "none",
                    background: "linear-gradient(135deg, #6366f1, #3b82f6)",
                    color: "#fff",
                    fontWeight: 600,
                    padding: "10px 20px",
                    cursor: submitting ? "not-allowed" : "pointer",
                    opacity: submitting ? 0.6 : 1,
                  }}
                >
                  {submitting ? "Sending…" : "Send invitation"}
                </button>
              </div>
            </div>
          </div>
        </form>

        <section style={{ marginTop: "32px" }}>
          <h3 style={{ fontSize: "18px", marginBottom: "16px" }}>
            Current collaborators
          </h3>
          {loading ? (
            <p style={{ color: "rgba(148, 163, 184, 0.8)" }}>Loading…</p>
          ) : collaborators.length === 0 ? (
            <p style={{ color: "rgba(148, 163, 184, 0.8)", fontSize: "14px" }}>
              No collaborators yet.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {collaborators.map((collaborator) => (
                <div
                  key={collaborator.userId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderRadius: "14px",
                    border: "1px solid rgba(148, 163, 184, 0.2)",
                    padding: "12px 16px",
                    background: "rgba(15, 23, 42, 0.7)",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {collaborator.userName}
                      {collaborator.isOwner && (
                        <span
                          style={{
                            marginLeft: "8px",
                            fontSize: "11px",
                            borderRadius: "999px",
                            border: "1px solid rgba(250, 204, 21, 0.5)",
                            padding: "2px 8px",
                            color: "rgba(250, 204, 21, 0.9)",
                          }}
                        >
                          Owner
                        </span>
                      )}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "13px",
                        color: "rgba(148, 163, 184, 0.8)",
                      }}
                    >
                      {collaborator.email}
                    </p>
                  </div>
                  {!collaborator.isOwner && (
                    <div style={{ display: "flex", gap: "8px" }}>
                      <select
                        value={collaborator.role}
                        onChange={(event) =>
                          handleChangeRole(
                            collaborator.userId,
                            event.target.value as InvitationRole
                          )
                        }
                        style={{
                          borderRadius: "10px",
                          border: "1px solid rgba(148, 163, 184, 0.35)",
                          background: "rgba(15, 23, 42, 0.9)",
                          color: "#e2e8f0",
                          padding: "6px 10px",
                        }}
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          handleRemoveCollaborator(
                            collaborator.userId,
                            collaborator.userName
                          )
                        }
                        style={{
                          borderRadius: "10px",
                          border: "none",
                          background: "rgba(239, 68, 68, 0.85)",
                          color: "#fff",
                          padding: "6px 12px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: "32px" }}>
          <h3 style={{ fontSize: "18px", marginBottom: "16px" }}>
            Pending invitations
          </h3>
          {pendingInvitations.length === 0 ? (
            <p style={{ color: "rgba(148, 163, 184, 0.8)", fontSize: "14px" }}>
              No pending invitations.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {pendingInvitations.map((invitation) => (
                <div
                  key={invitation.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "12px 16px",
                    borderRadius: "14px",
                    border: "1px solid rgba(148, 163, 184, 0.2)",
                    background: "rgba(15, 23, 42, 0.7)",
                    gap: "12px",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>
                      {invitation.inviteeEmail}
                    </p>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "13px",
                        color: "rgba(148, 163, 184, 0.8)",
                      }}
                    >
                      {invitation.role.charAt(0).toUpperCase() +
                        invitation.role.slice(1)}{" "}
                      • Expires{" "}
                      {new Date(invitation.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => handleResendInvitation(invitation.id)}
                      style={{
                        borderRadius: "10px",
                        border: "none",
                        background: "rgba(59, 130, 246, 0.85)",
                        color: "#fff",
                        padding: "6px 12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Resend
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancelInvitation(invitation.id)}
                      style={{
                        borderRadius: "10px",
                        border: "none",
                        background: "rgba(148, 163, 184, 0.25)",
                        color: "#e2e8f0",
                        padding: "6px 12px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}


import { CSSProperties, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";

import { authApi, useAuth } from "../lib/auth";

interface Document {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Template {
  id: string;
  title: string;
  updatedAt: string;
}

const formatDateTime = (isoString: string): string =>
  new Date(isoString).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const getStatusLabel = (status: string): string => {
  const statusMap: Record<string, string> = {
    uploaded: "Uploaded",
    extracted: "Extracted",
    draft_generated: "Draft Generated",
    exported: "Exported",
  };
  return statusMap[status] || status;
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState<boolean>(true);
  const [loadingTemplates, setLoadingTemplates] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        setLoadingDocuments(true);
        const response = await authApi.get("/documents");
        const data = response.data as { documents?: Document[] };
        setDocuments(data.documents ?? []);
      } catch (err) {
        console.error("Failed to fetch documents:", err);
        if (axios.isAxiosError(err)) {
          setError(err.response?.data?.error || "Failed to load documents");
        }
      } finally {
        setLoadingDocuments(false);
      }
    };

    const fetchTemplates = async () => {
      try {
        setLoadingTemplates(true);
        const response = await authApi.get("/templates");
        const data = response.data as {
          templates?: Array<{ id: string; title: string; updatedAt: string }>;
        };
        // Get only the most recent 5 templates
        const fetched = (data.templates ?? [])
          .map((t) => ({
            id: t.id,
            title: t.title,
            updatedAt: t.updatedAt,
          }))
          .slice(0, 5);
        setTemplates(fetched);
      } catch (err) {
        console.error("Failed to fetch templates:", err);
      } finally {
        setLoadingTemplates(false);
      }
    };

    void fetchDocuments();
    void fetchTemplates();
  }, []);

  const handleDeleteDocument = async (
    documentId: string,
    documentTitle: string
  ) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${documentTitle}"? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(documentId);
      await authApi.delete(`/documents/${documentId}`);

      // Remove the document from the local state
      setDocuments((prev) => prev.filter((doc) => doc.id !== documentId));
    } catch (err: any) {
      console.error("Failed to delete document:", err);
      const errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        "Failed to delete document";
      alert(`Error: ${errorMessage}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const pageStyles: CSSProperties = {
    minHeight: "100vh",
    background: "radial-gradient(circle at 15% 15%, #1e293b, #0f172a 60%)",
    color: "#e2e8f0",
    fontFamily:
      "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };

  const headerStyles: CSSProperties = {
    borderBottom: "1px solid rgba(71, 85, 105, 0.35)",
    background: "rgba(15, 23, 42, 0.55)",
    backdropFilter: "blur(12px)",
  };

  const headerContainerStyles: CSSProperties = {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "32px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  };

  const headerContentStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    flex: 1,
  };

  const titleStyles: CSSProperties = {
    fontSize: "32px",
    fontWeight: 700,
    color: "#f8fafc",
    margin: 0,
  };

  const welcomeStyles: CSSProperties = {
    fontSize: "14px",
    color: "rgba(203, 213, 225, 0.75)",
  };

  const logoutButtonStyles: CSSProperties = {
    borderRadius: "999px",
    padding: "12px 24px",
    fontWeight: 600,
    fontSize: "14px",
    cursor: "pointer",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    color: "rgba(226, 232, 240, 0.92)",
    background: "rgba(15, 23, 42, 0.5)",
    boxShadow: "0 14px 24px -18px rgba(15, 23, 42, 0.7)",
    transition:
      "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
    alignSelf: "flex-start",
  };

  const mainStyles: CSSProperties = {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "48px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "32px",
  };

  const gridStyles: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "24px",
  };

  const cardStyles: CSSProperties = {
    borderRadius: "22px",
    padding: "32px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.75))",
    boxShadow:
      "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  };

  const sectionTitleStyles: CSSProperties = {
    fontSize: "20px",
    fontWeight: 600,
    color: "#f8fafc",
    margin: 0,
  };

  const buttonGroupStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  };

  const primaryButtonStyles: CSSProperties = {
    borderRadius: "999px",
    padding: "14px 24px",
    fontWeight: 600,
    fontSize: "15px",
    border: "none",
    cursor: "pointer",
    background: "linear-gradient(135deg, #10b981, #059669)",
    color: "#052e16",
    boxShadow: "0 18px 30px -20px rgba(16, 185, 129, 0.55)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    textDecoration: "none",
    textAlign: "center" as const,
    display: "inline-block",
  };

  const secondaryButtonStyles: CSSProperties = {
    borderRadius: "999px",
    padding: "14px 24px",
    fontWeight: 600,
    fontSize: "15px",
    cursor: "pointer",
    border: "1px solid rgba(148, 163, 184, 0.35)",
    color: "rgba(226, 232, 240, 0.92)",
    background: "rgba(15, 23, 42, 0.5)",
    boxShadow: "0 14px 24px -18px rgba(15, 23, 42, 0.7)",
    transition:
      "transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease",
    textDecoration: "none",
    textAlign: "center" as const,
    display: "inline-block",
  };

  const templateListStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    listStyle: "none",
    padding: 0,
    margin: 0,
  };

  const templateItemStyles: CSSProperties = {
    borderRadius: "14px",
    padding: "16px 20px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background: "rgba(30, 41, 59, 0.4)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    transition: "border-color 0.2s ease, background 0.2s ease",
  };

  const templateTitleStyles: CSSProperties = {
    fontSize: "15px",
    fontWeight: 500,
    color: "#f8fafc",
    margin: 0,
  };

  const templateDateStyles: CSSProperties = {
    fontSize: "12px",
    color: "rgba(203, 213, 225, 0.65)",
    marginTop: "4px",
  };

  const linkStyles: CSSProperties = {
    fontSize: "14px",
    fontWeight: 600,
    color: "#6ee7b7",
    textDecoration: "none",
    transition: "color 0.2s ease",
  };

  const sectionHeaderStyles: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "20px",
  };

  const tableContainerStyles: CSSProperties = {
    overflowX: "auto",
    borderRadius: "14px",
  };

  const tableStyles: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse" as const,
  };

  const tableHeaderStyles: CSSProperties = {
    textAlign: "left" as const,
    fontSize: "12px",
    fontWeight: 600,
    color: "rgba(203, 213, 225, 0.75)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    paddingBottom: "12px",
    paddingRight: "16px",
    borderBottom: "1px solid rgba(71, 85, 105, 0.35)",
  };

  const tableRowStyles: CSSProperties = {
    borderBottom: "1px solid rgba(71, 85, 105, 0.2)",
    cursor: "pointer",
    transition: "background 0.2s ease",
  };

  const tableCellStyles: CSSProperties = {
    padding: "16px 16px 16px 0",
    fontSize: "14px",
    color: "rgba(226, 232, 240, 0.9)",
  };

  const tableCellTitleStyles: CSSProperties = {
    ...tableCellStyles,
    fontWeight: 500,
    color: "#f8fafc",
  };

  const statusBadgeStyles: CSSProperties = {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "6px 12px",
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    background: "rgba(16, 185, 129, 0.15)",
    color: "rgba(110, 231, 183, 0.9)",
    border: "1px solid rgba(16, 185, 129, 0.35)",
  };

  return (
    <div style={pageStyles}>
      <header style={headerStyles}>
        <div style={headerContainerStyles}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "16px",
            }}
          >
            <div style={headerContentStyles}>
              <h1 style={titleStyles}>Dashboard</h1>
              <p style={welcomeStyles}>
                Welcome back, {user?.email ?? "User"}.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              style={logoutButtonStyles}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.borderColor = "rgba(148, 163, 184, 0.6)";
                e.currentTarget.style.boxShadow =
                  "0 16px 28px -20px rgba(15, 23, 42, 0.75)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.borderColor = "rgba(148, 163, 184, 0.35)";
                e.currentTarget.style.boxShadow =
                  "0 14px 24px -18px rgba(15, 23, 42, 0.7)";
              }}
            >
              Log Out
            </button>
          </div>
        </div>
      </header>

      <main style={mainStyles}>
        <section style={gridStyles}>
          <article style={cardStyles}>
            <h2 style={sectionTitleStyles}>Quick Actions</h2>
            <div style={buttonGroupStyles}>
              <Link
                to="/upload"
                style={primaryButtonStyles}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow =
                    "0 22px 35px -22px rgba(16, 185, 129, 0.65)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow =
                    "0 18px 30px -20px rgba(16, 185, 129, 0.55)";
                }}
              >
                Upload Document
              </Link>
              <Link
                to="/templates/new"
                style={secondaryButtonStyles}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.borderColor =
                    "rgba(148, 163, 184, 0.6)";
                  e.currentTarget.style.boxShadow =
                    "0 16px 28px -20px rgba(15, 23, 42, 0.75)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.borderColor =
                    "rgba(148, 163, 184, 0.35)";
                  e.currentTarget.style.boxShadow =
                    "0 14px 24px -18px rgba(15, 23, 42, 0.7)";
                }}
              >
                New Template
              </Link>
              <Link
                to="/prompts"
                style={secondaryButtonStyles}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.borderColor =
                    "rgba(148, 163, 184, 0.6)";
                  e.currentTarget.style.boxShadow =
                    "0 16px 28px -20px rgba(15, 23, 42, 0.75)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.borderColor =
                    "rgba(148, 163, 184, 0.35)";
                  e.currentTarget.style.boxShadow =
                    "0 14px 24px -18px rgba(15, 23, 42, 0.7)";
                }}
              >
                Custom Prompts
              </Link>
              <Link
                to="/exports"
                style={secondaryButtonStyles}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.borderColor =
                    "rgba(148, 163, 184, 0.6)";
                  e.currentTarget.style.boxShadow =
                    "0 16px 28px -20px rgba(15, 23, 42, 0.75)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.borderColor =
                    "rgba(148, 163, 184, 0.35)";
                  e.currentTarget.style.boxShadow =
                    "0 14px 24px -18px rgba(15, 23, 42, 0.7)";
                }}
              >
                View Exports
              </Link>
            </div>
          </article>

          <article style={cardStyles}>
            <h2 style={sectionTitleStyles}>Recent Templates</h2>
            {loadingTemplates ? (
              <p
                style={{ color: "rgba(203, 213, 225, 0.65)", fontSize: "14px" }}
              >
                Loading templates...
              </p>
            ) : templates.length === 0 ? (
              <p
                style={{ color: "rgba(203, 213, 225, 0.65)", fontSize: "14px" }}
              >
                No templates yet. Create one to get started!
              </p>
            ) : (
              <ul style={templateListStyles}>
                {templates.map((template) => (
                  <li
                    key={template.id}
                    style={templateItemStyles}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor =
                        "rgba(148, 163, 184, 0.3)";
                      e.currentTarget.style.background =
                        "rgba(30, 41, 59, 0.55)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor =
                        "rgba(148, 163, 184, 0.18)";
                      e.currentTarget.style.background =
                        "rgba(30, 41, 59, 0.4)";
                    }}
                  >
                    <div>
                      <p style={templateTitleStyles}>{template.title}</p>
                      <p style={templateDateStyles}>
                        Updated {formatDateTime(template.updatedAt)}
                      </p>
                    </div>
                    <Link
                      to={`/templates/${template.id}`}
                      style={linkStyles}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "#34d399";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "#6ee7b7";
                      }}
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>

        <section style={cardStyles}>
          <div style={sectionHeaderStyles}>
            <h2 style={sectionTitleStyles}>Recent Documents</h2>
            <Link
              to="/upload"
              style={linkStyles}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#34d399";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#6ee7b7";
              }}
            >
              Upload new
            </Link>
          </div>
          {error && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "14px",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                background: "rgba(127, 29, 29, 0.6)",
                color: "rgba(254, 226, 226, 0.9)",
                fontSize: "14px",
                marginBottom: "20px",
              }}
            >
              {error}
            </div>
          )}
          {loadingDocuments ? (
            <p style={{ color: "rgba(203, 213, 225, 0.65)", fontSize: "14px" }}>
              Loading documents...
            </p>
          ) : documents.length === 0 ? (
            <p style={{ color: "rgba(203, 213, 225, 0.65)", fontSize: "14px" }}>
              No documents yet. Upload your first document to get started!
            </p>
          ) : (
            <div style={tableContainerStyles}>
              <table style={tableStyles}>
                <thead>
                  <tr>
                    <th style={tableHeaderStyles}>Title</th>
                    <th style={tableHeaderStyles}>Status</th>
                    <th style={tableHeaderStyles}>Created</th>
                    <th
                      style={{
                        ...tableHeaderStyles,
                        textAlign: "right" as const,
                        width: "100px",
                      }}
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((document) => (
                    <tr
                      key={document.id}
                      style={tableRowStyles}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                          "rgba(30, 41, 59, 0.4)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "transparent";
                      }}
                    >
                      <td
                        style={tableCellTitleStyles}
                        onClick={() => navigate(`/documents/${document.id}`)}
                      >
                        {document.title || "Untitled Document"}
                      </td>
                      <td
                        style={tableCellStyles}
                        onClick={() => navigate(`/documents/${document.id}`)}
                      >
                        <span style={statusBadgeStyles}>
                          {getStatusLabel(document.status)}
                        </span>
                      </td>
                      <td
                        style={tableCellStyles}
                        onClick={() => navigate(`/documents/${document.id}`)}
                      >
                        {formatDateTime(document.createdAt)}
                      </td>
                      <td
                        style={{
                          ...tableCellStyles,
                          textAlign: "right" as const,
                        }}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDocument(
                              document.id,
                              document.title || "Untitled Document"
                            );
                          }}
                          disabled={deletingId === document.id}
                          style={{
                            borderRadius: "14px",
                            border: "1px solid rgba(239, 68, 68, 0.5)",
                            background:
                              deletingId === document.id
                                ? "rgba(239, 68, 68, 0.3)"
                                : "rgba(127, 29, 29, 0.4)",
                            padding: "4px 12px",
                            fontSize: "12px",
                            fontWeight: 500,
                            color:
                              deletingId === document.id
                                ? "rgba(254, 226, 226, 0.7)"
                                : "rgba(254, 226, 226, 0.9)",
                            cursor:
                              deletingId === document.id
                                ? "not-allowed"
                                : "pointer",
                            transition:
                              "border-color 0.2s ease, background 0.2s ease, color 0.2s ease",
                            opacity: deletingId === document.id ? 0.6 : 1,
                          }}
                          onMouseEnter={(e) => {
                            if (deletingId !== document.id) {
                              e.currentTarget.style.borderColor =
                                "rgba(239, 68, 68, 0.7)";
                              e.currentTarget.style.background =
                                "rgba(127, 29, 29, 0.6)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (deletingId !== document.id) {
                              e.currentTarget.style.borderColor =
                                "rgba(239, 68, 68, 0.5)";
                              e.currentTarget.style.background =
                                "rgba(127, 29, 29, 0.4)";
                            }
                          }}
                        >
                          {deletingId === document.id
                            ? "Deleting..."
                            : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default Dashboard;

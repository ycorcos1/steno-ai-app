import { CSSProperties, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { authApi } from "../lib/auth";

interface Export {
  id: string;
  documentId: string;
  documentTitle: string;
  fileName: string;
  createdAt: string;
  expiresAt: string;
  isExpired: boolean;
  downloadUrl: string | null;
}

const formatDateTime = (isoString: string): string =>
  new Date(isoString).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const Exports: React.FC = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [exports, setExports] = useState<Export[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchExports = async () => {
      try {
        const response = await authApi.get("/exports");

        const data = response.data as { exports?: Export[] };
        setExports(data.exports || []);
      } catch (err: any) {
        if (err.response?.status === 401) {
          await logout();
          navigate("/login", { replace: true });
          return;
        }
        setError(
          err.response?.data?.error ||
            err.response?.data?.message ||
            err.message ||
            "Failed to fetch exports"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchExports();
  }, [navigate, logout]);

  const handleDownload = (downloadUrl: string, fileName: string) => {
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    link.click();
  };

  // Inline CSS styles matching theme
  const pageStyles: CSSProperties = {
    minHeight: "100vh",
    background: "radial-gradient(circle at 15% 15%, #1e293b, #0f172a 65%)",
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
    maxWidth: "1152px",
    margin: "0 auto",
    padding: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  const headerContentStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  };

  const titleStyles: CSSProperties = {
    fontSize: "30px",
    fontWeight: 600,
    color: "#f8fafc",
    margin: 0,
  };

  const subtitleStyles: CSSProperties = {
    fontSize: "14px",
    color: "rgba(203, 213, 225, 0.8)",
  };

  const backButtonStyles: CSSProperties = {
    borderRadius: "14px",
    border: "1px solid rgba(71, 85, 105, 0.5)",
    background: "rgba(15, 23, 42, 0.5)",
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: 500,
    color: "rgba(241, 245, 249, 0.9)",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "border-color 0.2s ease, color 0.2s ease",
  };

  const mainStyles: CSSProperties = {
    maxWidth: "1152px",
    margin: "0 auto",
    padding: "40px 24px",
  };

  const loadingStyles: CSSProperties = {
    textAlign: "center" as const,
    color: "rgba(148, 163, 184, 0.8)",
    fontSize: "14px",
  };

  const errorCardStyles: CSSProperties = {
    borderRadius: "14px",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    background: "rgba(127, 29, 29, 0.6)",
    padding: "16px",
    color: "rgba(248, 113, 113, 0.9)",
    fontSize: "14px",
    marginBottom: "24px",
  };

  const emptyStateStyles: CSSProperties = {
    borderRadius: "22px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.75))",
    boxShadow:
      "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
    padding: "32px",
    textAlign: "center" as const,
  };

  const emptyStateTitleStyles: CSSProperties = {
    fontSize: "18px",
    color: "rgba(203, 213, 225, 0.9)",
    marginBottom: "8px",
  };

  const emptyStateTextStyles: CSSProperties = {
    marginTop: "8px",
    fontSize: "14px",
    color: "rgba(148, 163, 184, 0.8)",
  };

  const emptyStateButtonStyles: CSSProperties = {
    marginTop: "16px",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #10b981, #059669)",
    border: "none",
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: 500,
    color: "#052e16",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 18px 30px -20px rgba(16, 185, 129, 0.55)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  };

  const tableContainerStyles: CSSProperties = {
    borderRadius: "22px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.75))",
    boxShadow:
      "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
    overflow: "hidden",
  };

  const tableStyles: CSSProperties = {
    width: "100%",
    borderCollapse: "collapse" as const,
  };

  const theadStyles: CSSProperties = {
    background: "rgba(30, 41, 59, 0.5)",
  };

  const thStyles: CSSProperties = {
    padding: "12px 24px",
    textAlign: "left" as const,
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "rgba(148, 163, 184, 0.8)",
  };

  const thRightStyles: CSSProperties = {
    ...thStyles,
    textAlign: "right" as const,
  };

  const tbodyStyles: CSSProperties = {
    borderTop: "1px solid rgba(71, 85, 105, 0.35)",
  };

  const trStyles: CSSProperties = {
    borderBottom: "1px solid rgba(71, 85, 105, 0.2)",
    transition: "background 0.2s ease",
  };

  const tdStyles: CSSProperties = {
    padding: "16px 24px",
    fontSize: "14px",
    color: "rgba(203, 213, 225, 0.9)",
  };

  const tdRightStyles: CSSProperties = {
    ...tdStyles,
    textAlign: "right" as const,
  };

  const linkStyles: CSSProperties = {
    fontWeight: 500,
    color: "#6ee7b7",
    textDecoration: "none",
    transition: "color 0.2s ease",
  };

  const badgeStyles: CSSProperties = {
    display: "inline-flex",
    borderRadius: "999px",
    padding: "4px 12px",
    fontSize: "12px",
    fontWeight: 600,
  };

  const badgeExpiredStyles: CSSProperties = {
    ...badgeStyles,
    background: "rgba(127, 29, 29, 0.4)",
    color: "rgba(252, 165, 165, 0.9)",
  };

  const badgeAvailableStyles: CSSProperties = {
    ...badgeStyles,
    background: "rgba(6, 78, 59, 0.4)",
    color: "rgba(110, 231, 183, 0.9)",
  };

  const downloadButtonStyles: CSSProperties = {
    borderRadius: "14px",
    background: "linear-gradient(135deg, #10b981, #059669)",
    border: "none",
    padding: "6px 12px",
    fontSize: "14px",
    fontWeight: 500,
    color: "#052e16",
    cursor: "pointer",
    boxShadow: "0 18px 30px -20px rgba(16, 185, 129, 0.55)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const unavailableTextStyles: CSSProperties = {
    fontSize: "14px",
    color: "rgba(100, 116, 139, 0.8)",
  };

  return (
    <div style={pageStyles}>
      <header style={headerStyles}>
        <div style={headerContainerStyles}>
          <div style={headerContentStyles}>
            <h1 style={titleStyles}>Exports</h1>
            <p style={subtitleStyles}>Download your exported documents</p>
          </div>
          <Link
            to="/dashboard"
            style={backButtonStyles}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(148, 163, 184, 0.6)";
              e.currentTarget.style.color = "#f8fafc";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.5)";
              e.currentTarget.style.color = "rgba(241, 245, 249, 0.9)";
            }}
          >
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main style={mainStyles}>
        {loading && <div style={loadingStyles}>Loading exports...</div>}

        {error && <div style={errorCardStyles}>Error: {error}</div>}

        {!loading && !error && exports.length === 0 && (
          <div style={emptyStateStyles}>
            <p style={emptyStateTitleStyles}>No exports yet</p>
            <p style={emptyStateTextStyles}>
              Export documents from the editor to see them here
            </p>
            <Link
              to="/dashboard"
              style={emptyStateButtonStyles}
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
              Go to Dashboard
            </Link>
          </div>
        )}

        {!loading && !error && exports.length > 0 && (
          <div style={tableContainerStyles}>
            <table style={tableStyles}>
              <thead style={theadStyles}>
                <tr>
                  <th style={thStyles}>Document</th>
                  <th style={thStyles}>File Name</th>
                  <th style={thStyles}>Created</th>
                  <th style={thStyles}>Expires</th>
                  <th style={thStyles}>Status</th>
                  <th style={thRightStyles}>Action</th>
                </tr>
              </thead>
              <tbody style={tbodyStyles}>
                {exports.map((exp) => (
                  <tr
                    key={exp.id}
                    style={trStyles}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        "rgba(30, 41, 59, 0.4)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <td style={tdStyles}>
                      <Link
                        to={`/documents/${exp.documentId}`}
                        style={linkStyles}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.color = "#34d399";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.color = "#6ee7b7";
                        }}
                      >
                        {exp.documentTitle}
                      </Link>
                    </td>
                    <td style={tdStyles}>{exp.fileName}</td>
                    <td style={tdStyles}>{formatDateTime(exp.createdAt)}</td>
                    <td style={tdStyles}>{formatDateTime(exp.expiresAt)}</td>
                    <td style={tdStyles}>
                      {exp.isExpired ? (
                        <span style={badgeExpiredStyles}>Expired</span>
                      ) : (
                        <span style={badgeAvailableStyles}>Available</span>
                      )}
                    </td>
                    <td style={tdRightStyles}>
                      {exp.downloadUrl && !exp.isExpired ? (
                        <button
                          onClick={() =>
                            handleDownload(exp.downloadUrl!, exp.fileName)
                          }
                          style={downloadButtonStyles}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.transform =
                              "translateY(-2px)";
                            e.currentTarget.style.boxShadow =
                              "0 22px 35px -22px rgba(16, 185, 129, 0.65)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.transform = "translateY(0)";
                            e.currentTarget.style.boxShadow =
                              "0 18px 30px -20px rgba(16, 185, 129, 0.55)";
                          }}
                        >
                          Download
                        </button>
                      ) : (
                        <span style={unavailableTextStyles}>Unavailable</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
};

export default Exports;

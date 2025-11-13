import axios from "axios";
import { CSSProperties, useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { authApi } from "../lib/auth";

interface Refinement {
  id: string;
  prompt: string | null;
  result: string;
  createdAt: string;
  isOriginal?: boolean;
}

const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { error?: string; message?: string }
      | undefined;
    return (
      data?.message ??
      data?.error ??
      error.response?.statusText ??
      error.message ??
      "Request failed"
    );
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong";
};

const formatDate = (isoString: string): string => {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const History: React.FC = () => {
  const { id: documentId } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [refinements, setRefinements] = useState<Refinement[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showRestoreModal, setShowRestoreModal] = useState<boolean>(false);
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);

  useEffect(() => {
    const fetchRefinements = async () => {
      if (!documentId) {
        setError("No document ID provided");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const response = await authApi.get(
          `/documents/${documentId}/refinements`
        );
        const data = response.data as { refinements: Refinement[] };
        setRefinements(data.refinements || []);
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };

    void fetchRefinements();
  }, [documentId]);

  const handleRestoreClick = (refinementId: string) => {
    setPendingRestoreId(refinementId);
    setShowRestoreModal(true);
  };

  const handleRestoreConfirm = async () => {
    if (!documentId || !pendingRestoreId) {
      return;
    }

    setShowRestoreModal(false);
    const refinementId = pendingRestoreId;
    setPendingRestoreId(null);

    try {
      setRestoringId(refinementId);
      console.log(
        `Restoring refinement ${refinementId} for document ${documentId}`
      );
      const response = await authApi.post(`/documents/${documentId}/restore`, {
        refinementId,
      });
      console.log("Restore response:", response.data);

      // Redirect back to editor
      navigate(`/documents/${documentId}`);
    } catch (err) {
      console.error("Restore error:", err);
      const errorMessage = getErrorMessage(err);
      alert(`Failed to restore: ${errorMessage}`);
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestoreCancel = () => {
    setShowRestoreModal(false);
    setPendingRestoreId(null);
  };

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedIds(newExpanded);
  };

  const truncateText = (text: string, maxLength: number = 300): string => {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + "...";
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
    maxWidth: "896px",
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
  };

  const headerLabelStyles: CSSProperties = {
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "rgba(110, 231, 183, 0.7)",
  };

  const headerTitleStyles: CSSProperties = {
    fontSize: "30px",
    fontWeight: 600,
    color: "#f8fafc",
    margin: 0,
  };

  const headerSubtitleStyles: CSSProperties = {
    marginTop: "8px",
    fontSize: "14px",
    color: "rgba(203, 213, 225, 0.8)",
  };

  const backLinkStyles: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "14px",
    color: "#6ee7b7",
    textDecoration: "none",
    transition: "color 0.2s ease",
  };

  const mainStyles: CSSProperties = {
    maxWidth: "896px",
    margin: "0 auto",
    padding: "32px 24px",
  };

  const errorCardStyles: CSSProperties = {
    marginBottom: "24px",
    borderRadius: "22px",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    background: "rgba(127, 29, 29, 0.6)",
    padding: "12px 16px",
    fontSize: "14px",
    color: "rgba(254, 226, 226, 0.9)",
  };

  const loadingStyles: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 0",
  };

  const loadingTextStyles: CSSProperties = {
    color: "rgba(148, 163, 184, 0.8)",
    fontSize: "14px",
  };

  const emptyStateStyles: CSSProperties = {
    borderRadius: "22px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.75))",
    boxShadow:
      "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
    padding: "48px 24px",
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
    color: "rgba(100, 116, 139, 0.8)",
  };

  const emptyStateButtonStyles: CSSProperties = {
    marginTop: "16px",
    borderRadius: "14px",
    background: "linear-gradient(135deg, #10b981, #059669)",
    border: "none",
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: 600,
    color: "#052e16",
    textDecoration: "none",
    display: "inline-block",
    boxShadow: "0 18px 30px -20px rgba(16, 185, 129, 0.55)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
  };

  const timelineContainerStyles: CSSProperties = {
    position: "relative" as const,
  };

  const timelineLineStyles: CSSProperties = {
    position: "absolute" as const,
    left: "32px",
    top: 0,
    bottom: 0,
    width: "2px",
    background: "rgba(71, 85, 105, 0.4)",
  };

  const timelineListStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  };

  const timelineItemStyles: CSSProperties = {
    position: "relative" as const,
    display: "flex",
    gap: "24px",
    paddingLeft: "80px",
  };

  const timelineDotStyles: CSSProperties = {
    position: "absolute" as const,
    left: "24px",
    top: "8px",
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    border: "2px solid rgba(51, 65, 85, 0.8)",
    background: "rgba(15, 23, 42, 0.9)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const timelineDotInnerStyles: CSSProperties = {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "rgba(16, 185, 129, 1)",
  };

  const cardStyles: CSSProperties = {
    flex: 1,
    borderRadius: "22px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.75))",
    boxShadow:
      "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
    padding: "24px",
  };

  const cardHeaderStyles: CSSProperties = {
    marginBottom: "16px",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "16px",
  };

  const cardHeaderContentStyles: CSSProperties = {
    flex: 1,
  };

  const dateStyles: CSSProperties = {
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "rgba(148, 163, 184, 0.8)",
  };

  const currentBadgeStyles: CSSProperties = {
    marginLeft: "12px",
    display: "inline-block",
    borderRadius: "999px",
    border: "1px solid rgba(16, 185, 129, 0.4)",
    background: "rgba(16, 185, 129, 0.1)",
    padding: "2px 8px",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "rgba(209, 250, 229, 0.9)",
  };

  const restoreButtonStyles: CSSProperties = {
    borderRadius: "14px",
    border: "1px solid rgba(16, 185, 129, 0.6)",
    background: "rgba(16, 185, 129, 0.1)",
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: 600,
    color: "rgba(110, 231, 183, 0.9)",
    cursor: "pointer",
    transition: "border-color 0.2s ease, background 0.2s ease",
  };

  const restoreButtonDisabledStyles: CSSProperties = {
    ...restoreButtonStyles,
    opacity: 0.5,
    cursor: "not-allowed",
  };

  const cardContentStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  };

  const sectionTitleStyles: CSSProperties = {
    marginBottom: "8px",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "rgba(148, 163, 184, 0.8)",
  };

  const promptBoxStyles: CSSProperties = {
    borderRadius: "14px",
    background: "rgba(15, 23, 42, 0.4)",
    padding: "12px",
    fontSize: "14px",
    fontStyle: "italic",
    color: "rgba(226, 232, 240, 0.9)",
    lineHeight: 1.6,
  };

  const resultBoxStyles: CSSProperties = {
    borderRadius: "14px",
    background: "rgba(15, 23, 42, 0.4)",
    padding: "12px",
    fontSize: "14px",
    color: "rgba(226, 232, 240, 0.9)",
    lineHeight: 1.6,
  };

  const resultTextStyles: CSSProperties = {
    whiteSpace: "pre-wrap" as const,
  };

  const expandButtonStyles: CSSProperties = {
    marginTop: "8px",
    fontSize: "12px",
    color: "#6ee7b7",
    background: "none",
    border: "none",
    cursor: "pointer",
    transition: "color 0.2s ease",
  };

  return (
    <div style={pageStyles}>
      <header style={headerStyles}>
        <div style={headerContainerStyles}>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <div style={headerContentStyles}>
              <p style={headerLabelStyles}>Refinement History</p>
              <h1 style={headerTitleStyles}>Document Revisions</h1>
              <p style={headerSubtitleStyles}>
                View and restore previous versions of your draft
              </p>
            </div>
            <Link
              to={`/documents/${documentId}`}
              style={backLinkStyles}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#34d399";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#6ee7b7";
              }}
            >
              ← Back to Editor
            </Link>
          </div>
        </div>
      </header>

      <main style={mainStyles}>
        {error && <div style={errorCardStyles}>Error: {error}</div>}

        {loading ? (
          <div style={loadingStyles}>
            <p style={loadingTextStyles}>Loading refinements...</p>
          </div>
        ) : refinements.length === 0 ? (
          <div style={emptyStateStyles}>
            <p style={emptyStateTitleStyles}>No refinements yet.</p>
            <p style={emptyStateTextStyles}>
              Return to the editor to refine your draft.
            </p>
            <Link
              to={`/documents/${documentId}`}
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
              Go to Editor
            </Link>
          </div>
        ) : (
          <div style={timelineContainerStyles}>
            <div style={timelineLineStyles} />
            <div style={timelineListStyles}>
              {refinements.map((refinement, index) => {
                const isExpanded = expandedIds.has(refinement.id);
                const isCurrent = index === 0; // First item is the newest/current version
                const resultText = isExpanded
                  ? refinement.result
                  : truncateText(refinement.result, 300);

                return (
                  <div key={refinement.id} style={timelineItemStyles}>
                    <div style={timelineDotStyles}>
                      <div style={timelineDotInnerStyles} />
                    </div>
                    <div style={cardStyles}>
                      <div style={cardHeaderStyles}>
                        <div style={cardHeaderContentStyles}>
                          <p style={dateStyles}>
                            {formatDate(refinement.createdAt)}
                            {isCurrent && (
                              <span style={currentBadgeStyles}>Current</span>
                            )}
                          </p>
                        </div>
                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => handleRestoreClick(refinement.id)}
                            disabled={restoringId === refinement.id}
                            style={
                              restoringId === refinement.id
                                ? restoreButtonDisabledStyles
                                : restoreButtonStyles
                            }
                            onMouseEnter={(e) => {
                              if (restoringId !== refinement.id) {
                                e.currentTarget.style.borderColor =
                                  "rgba(16, 185, 129, 0.8)";
                                e.currentTarget.style.background =
                                  "rgba(16, 185, 129, 0.2)";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (restoringId !== refinement.id) {
                                e.currentTarget.style.borderColor =
                                  "rgba(16, 185, 129, 0.6)";
                                e.currentTarget.style.background =
                                  "rgba(16, 185, 129, 0.1)";
                              }
                            }}
                          >
                            {restoringId === refinement.id
                              ? "Restoring..."
                              : "Restore this version"}
                          </button>
                        )}
                      </div>

                      <div style={cardContentStyles}>
                        {refinement.isOriginal ? (
                          <div>
                            <p style={sectionTitleStyles}>Original Draft</p>
                            <div style={resultBoxStyles}>
                              <p style={resultTextStyles}>{resultText}</p>
                              {refinement.result.length > 300 && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpand(refinement.id)}
                                  style={expandButtonStyles}
                                  onMouseEnter={(e) => {
                                    e.currentTarget.style.color = "#34d399";
                                  }}
                                  onMouseLeave={(e) => {
                                    e.currentTarget.style.color = "#6ee7b7";
                                  }}
                                >
                                  {isExpanded ? "Show less" : "Show more"}
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div>
                              <p style={sectionTitleStyles}>
                                Refinement Request
                              </p>
                              <p style={promptBoxStyles}>
                                {refinement.prompt || "No prompt provided"}
                              </p>
                            </div>

                            <div>
                              <p style={sectionTitleStyles}>Refined Draft</p>
                              <div style={resultBoxStyles}>
                                <p style={resultTextStyles}>{resultText}</p>
                                {refinement.result.length > 300 && (
                                  <button
                                    type="button"
                                    onClick={() => toggleExpand(refinement.id)}
                                    style={expandButtonStyles}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.color = "#34d399";
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.color = "#6ee7b7";
                                    }}
                                  >
                                    {isExpanded ? "Show less" : "Show more"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Restore Confirmation Modal */}
      {showRestoreModal && (
        <div
          style={{
            position: "fixed" as const,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            backdropFilter: "blur(4px)",
          }}
          onClick={handleRestoreCancel}
        >
          <div
            style={{
              borderRadius: "22px",
              border: "1px solid rgba(148, 163, 184, 0.18)",
              background:
                "linear-gradient(180deg, rgba(17, 24, 39, 0.98), rgba(17, 24, 39, 0.95))",
              boxShadow:
                "0 35px 55px -35px rgba(15, 23, 42, 0.9), 0 20px 30px -25px rgba(15, 23, 42, 0.8)",
              padding: "32px",
              maxWidth: "500px",
              width: "90%",
              color: "#e2e8f0",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              style={{
                fontSize: "20px",
                fontWeight: 600,
                color: "#f8fafc",
                marginBottom: "16px",
                marginTop: 0,
              }}
            >
              Restore Version
            </h2>
            <p
              style={{
                fontSize: "14px",
                color: "rgba(203, 213, 225, 0.9)",
                lineHeight: 1.6,
                marginBottom: "24px",
              }}
            >
              This will replace your current draft with this version and remove
              all newer versions. Continue?
            </p>
            <div
              style={{
                display: "flex",
                gap: "12px",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={handleRestoreCancel}
                style={{
                  borderRadius: "14px",
                  border: "1px solid rgba(71, 85, 105, 0.5)",
                  background: "rgba(15, 23, 42, 0.6)",
                  padding: "10px 20px",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "rgba(203, 213, 225, 0.9)",
                  cursor: "pointer",
                  transition: "border-color 0.2s ease, background 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.7)";
                  e.currentTarget.style.background = "rgba(15, 23, 42, 0.8)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.5)";
                  e.currentTarget.style.background = "rgba(15, 23, 42, 0.6)";
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRestoreConfirm}
                style={{
                  borderRadius: "14px",
                  background: "linear-gradient(135deg, #10b981, #059669)",
                  border: "none",
                  padding: "10px 20px",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#052e16",
                  cursor: "pointer",
                  boxShadow: "0 18px 30px -20px rgba(16, 185, 129, 0.55)",
                  transition: "transform 0.2s ease, box-shadow 0.2s ease",
                }}
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
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default History;

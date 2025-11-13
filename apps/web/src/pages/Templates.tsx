import axios from "axios";
import {
  CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { authApi } from "../lib/auth";

interface Template {
  id: string;
  title: string;
  content: string;
  isGlobal: boolean;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
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

const Templates: React.FC = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await authApi.get("/templates");
      const data = response.data as { templates?: Template[] };
      setTemplates(data.templates ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const personalTemplates = useMemo(
    () =>
      templates.filter((template) => template.isOwner && !template.isGlobal),
    [templates]
  );

  const firmTemplates = useMemo(
    () => templates.filter((template) => template.isGlobal),
    [templates]
  );

  const viewOnlyTemplates = useMemo(
    () =>
      templates.filter((template) => !template.isOwner && !template.isGlobal),
    [templates]
  );

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

  const handleDelete = async (template: Template) => {
    const confirmed = window.confirm(
      `Delete "${template.title}"? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(template.id);
      await authApi.delete(`/templates/${template.id}`);
      await loadTemplates();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  const renderTemplateCard = (template: Template, headerColor: string) => {
    const canEdit = template.isOwner && !template.isGlobal;
    const label = template.isGlobal
      ? "Firm-wide template"
      : template.isOwner
      ? "Your template"
      : "Shared template";

    const cardStyles: CSSProperties = {
      borderRadius: "22px",
      border: "1px solid rgba(148, 163, 184, 0.18)",
      background:
        "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.75))",
      boxShadow:
        "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
      padding: "20px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      gap: "16px",
    };

    const headerStyles: CSSProperties = {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "16px",
    };

    const labelStyles: CSSProperties = {
      fontSize: "12px",
      fontWeight: 600,
      textTransform: "uppercase" as const,
      letterSpacing: "0.05em",
      color: headerColor,
    };

    const titleStyles: CSSProperties = {
      marginTop: "4px",
      fontSize: "18px",
      fontWeight: 600,
      color: "#f8fafc",
    };

    const dateStyles: CSSProperties = {
      fontSize: "12px",
      color: "rgba(148, 163, 184, 0.8)",
    };

    const contentStyles: CSSProperties = {
      marginTop: "16px",
      fontSize: "14px",
      color: "rgba(203, 213, 225, 0.8)",
      lineHeight: 1.6,
      display: "-webkit-box",
      WebkitLineClamp: 4,
      WebkitBoxOrient: "vertical" as const,
      overflow: "hidden",
    };

    const footerStyles: CSSProperties = {
      marginTop: "24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    };

    const linkStyles: CSSProperties = {
      fontSize: "14px",
      fontWeight: 500,
      color: "#6ee7b7",
      textDecoration: "none",
      transition: "color 0.2s ease",
    };

    const deleteButtonStyles: CSSProperties = {
      fontSize: "14px",
      fontWeight: 500,
      color: "rgba(251, 113, 133, 0.9)",
      background: "none",
      border: "none",
      cursor: "pointer",
      transition: "color 0.2s ease",
    };

    return (
      <article key={template.id} style={cardStyles}>
        <header style={headerStyles}>
          <div>
            <p style={labelStyles}>{label}</p>
            <h3 style={titleStyles}>{template.title}</h3>
          </div>
          <span style={dateStyles}>
            Updated {formatDate(template.updatedAt)}
          </span>
        </header>
        <p style={contentStyles}>
          {template.content.slice(0, 220)}
          {template.content.length > 220 ? "…" : ""}
        </p>
        <footer style={footerStyles}>
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
            {canEdit ? "Edit template" : "View details"}
          </Link>

          {canEdit && (
            <button
              type="button"
              onClick={() => void handleDelete(template)}
              disabled={deletingId === template.id}
              style={{
                ...deleteButtonStyles,
                opacity: deletingId === template.id ? 0.5 : 1,
                cursor: deletingId === template.id ? "not-allowed" : "pointer",
                color:
                  deletingId === template.id
                    ? "rgba(148, 163, 184, 0.8)"
                    : "rgba(251, 113, 133, 0.9)",
              }}
              onMouseEnter={(e) => {
                if (deletingId !== template.id) {
                  e.currentTarget.style.color = "rgba(248, 113, 113, 1)";
                }
              }}
              onMouseLeave={(e) => {
                if (deletingId !== template.id) {
                  e.currentTarget.style.color = "rgba(251, 113, 133, 0.9)";
                }
              }}
            >
              {deletingId === template.id ? "Deleting…" : "Delete"}
            </button>
          )}
        </footer>
      </article>
    );
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

  const createButtonStyles: CSSProperties = {
    borderRadius: "14px",
    background: "linear-gradient(135deg, #10b981, #059669)",
    border: "none",
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: 600,
    color: "#052e16",
    cursor: "pointer",
    boxShadow: "0 18px 30px -20px rgba(16, 185, 129, 0.55)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textDecoration: "none",
  };

  const mainStyles: CSSProperties = {
    maxWidth: "1152px",
    margin: "0 auto",
    padding: "40px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "40px",
  };

  const errorCardStyles: CSSProperties = {
    borderRadius: "22px",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    background: "rgba(127, 29, 29, 0.6)",
    padding: "12px 16px",
    fontSize: "14px",
  };

  const errorTitleStyles: CSSProperties = {
    fontWeight: 600,
    color: "rgba(254, 226, 226, 0.9)",
    marginBottom: "4px",
  };

  const errorTextStyles: CSSProperties = {
    marginTop: "4px",
    color: "rgba(254, 226, 226, 0.8)",
    fontSize: "14px",
  };

  const sectionHeaderStyles: CSSProperties = {
    marginBottom: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  const sectionTitleStyles: CSSProperties = {
    fontSize: "18px",
    fontWeight: 600,
    color: "#f8fafc",
  };

  const sectionCountStyles: CSSProperties = {
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "rgba(148, 163, 184, 0.8)",
  };

  const emptyStateStyles: CSSProperties = {
    borderRadius: "22px",
    border: "1px dashed rgba(71, 85, 105, 0.5)",
    background: "rgba(30, 41, 59, 0.3)",
    padding: "48px 24px",
    textAlign: "center" as const,
  };

  const emptyStateTextStyles: CSSProperties = {
    fontSize: "14px",
    color: "rgba(203, 213, 225, 0.9)",
  };

  const emptyStateLinkStyles: CSSProperties = {
    marginLeft: "8px",
    fontWeight: 500,
    color: "#6ee7b7",
    textDecoration: "none",
    transition: "color 0.2s ease",
  };

  const gridStyles: CSSProperties = {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
  };

  return (
    <div style={pageStyles}>
      <header style={headerStyles}>
        <div style={headerContainerStyles}>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <div style={headerContentStyles}>
              <p style={headerLabelStyles}>Template Library</p>
              <h1 style={headerTitleStyles}>Templates & Playbooks</h1>
              <p style={headerSubtitleStyles}>
                Manage your personal templates and view firm-approved versions
                for consistent drafting.
              </p>
            </div>
            <Link
              to="/templates/new"
              style={createButtonStyles}
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
              Create template
            </Link>
          </div>
        </div>
      </header>

      <main style={mainStyles}>
        {error && (
          <div style={errorCardStyles}>
            <p style={errorTitleStyles}>Unable to load templates</p>
            <p style={errorTextStyles}>{error}</p>
          </div>
        )}

        {loading ? (
          <section
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <div
              style={{
                height: "32px",
                width: "160px",
                borderRadius: "14px",
                background: "rgba(51, 65, 85, 0.5)",
              }}
            />
            <div style={gridStyles}>
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  style={{
                    height: "192px",
                    borderRadius: "22px",
                    background: "rgba(30, 41, 59, 0.5)",
                  }}
                />
              ))}
            </div>
          </section>
        ) : (
          <>
            <section>
              <header style={sectionHeaderStyles}>
                <h2 style={sectionTitleStyles}>Your templates</h2>
                <span style={sectionCountStyles}>
                  {personalTemplates.length} saved
                </span>
              </header>
              {personalTemplates.length === 0 ? (
                <div style={emptyStateStyles}>
                  <p style={emptyStateTextStyles}>
                    You haven&apos;t created any personal templates yet.
                    <Link
                      to="/templates/new"
                      style={emptyStateLinkStyles}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = "#34d399";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = "#6ee7b7";
                      }}
                    >
                      Create your first template.
                    </Link>
                  </p>
                </div>
              ) : (
                <div style={gridStyles}>
                  {personalTemplates.map((template) =>
                    renderTemplateCard(template, "rgba(110, 231, 183, 0.9)")
                  )}
                </div>
              )}
            </section>

            <section>
              <header style={sectionHeaderStyles}>
                <h2 style={sectionTitleStyles}>Firm templates</h2>
                <span style={sectionCountStyles}>
                  {firmTemplates.length} available
                </span>
              </header>
              {firmTemplates.length === 0 ? (
                <div style={emptyStateStyles}>
                  <p style={emptyStateTextStyles}>
                    No firm templates are available yet.
                  </p>
                </div>
              ) : (
                <div style={gridStyles}>
                  {firmTemplates.map((template) =>
                    renderTemplateCard(template, "rgba(125, 211, 252, 0.9)")
                  )}
                </div>
              )}
            </section>

            {viewOnlyTemplates.length > 0 && (
              <section>
                <header style={sectionHeaderStyles}>
                  <h2 style={sectionTitleStyles}>Shared with you</h2>
                  <span style={sectionCountStyles}>
                    {viewOnlyTemplates.length} templates
                  </span>
                </header>
                <div style={gridStyles}>
                  {viewOnlyTemplates.map((template) =>
                    renderTemplateCard(template, "rgba(196, 181, 253, 0.9)")
                  )}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default Templates;

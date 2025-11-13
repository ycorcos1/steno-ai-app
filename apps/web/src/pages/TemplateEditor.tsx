import axios from "axios";
import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { authApi } from "../lib/auth";

interface TemplatePayload {
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

const TemplateEditor: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const isNew = !params.id || params.id === "new";

  const [loading, setLoading] = useState<boolean>(!isNew);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [templateMeta, setTemplateMeta] = useState<Pick<
    TemplatePayload,
    "id" | "isGlobal" | "isOwner" | "createdAt" | "updatedAt"
  > | null>(null);

  useEffect(() => {
    if (isNew) {
      setTitle("");
      setContent("");
      setTemplateMeta(null);
      setLoading(false);
      return;
    }

    const fetchTemplate = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await authApi.get(`/templates/${params.id}`);
        const payload = (response.data as { template: TemplatePayload })
          .template;

        setTitle(payload.title);
        setContent(payload.content);
        setTemplateMeta({
          id: payload.id,
          isGlobal: payload.isGlobal,
          isOwner: payload.isOwner,
          createdAt: payload.createdAt,
          updatedAt: payload.updatedAt,
        });
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        setLoading(false);
      }
    };

    void fetchTemplate();
  }, [isNew, params.id]);

  const canEdit = useMemo(() => {
    if (isNew) {
      return true;
    }

    if (!templateMeta) {
      return false;
    }

    return templateMeta.isOwner && !templateMeta.isGlobal;
  }, [isNew, templateMeta]);

  const headerTitle = isNew
    ? "Create template"
    : canEdit
    ? "Edit template"
    : "Template details";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      if (isNew) {
        await authApi.post("/templates", {
          title,
          content,
        });
      } else {
        const targetId = templateMeta?.id ?? params.id;
        if (!targetId) {
          throw new Error("Template not loaded. Please refresh and try again.");
        }

        await authApi.put(`/templates/${targetId}`, {
          title,
          content,
        });
      }

      navigate("/templates", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
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
    gap: "8px",
  };

  const breadcrumbStyles: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.1em",
    color: "rgba(148, 163, 184, 0.8)",
  };

  const breadcrumbLinkStyles: CSSProperties = {
    color: "#6ee7b7",
    textDecoration: "none",
    transition: "color 0.2s ease",
  };

  const breadcrumbSeparatorStyles: CSSProperties = {
    color: "rgba(71, 85, 105, 0.6)",
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

  const mainStyles: CSSProperties = {
    maxWidth: "896px",
    margin: "0 auto",
    padding: "40px 24px",
  };

  const loadingContainerStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  };

  const loadingBoxStyles: CSSProperties = {
    borderRadius: "14px",
    background: "rgba(51, 65, 85, 0.4)",
  };

  const formStyles: CSSProperties = {
    borderRadius: "22px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.75))",
    boxShadow:
      "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  };

  const metaStyles: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "24px",
    fontSize: "12px",
    color: "rgba(148, 163, 184, 0.8)",
  };

  const metaStrongStyles: CSSProperties = {
    color: "rgba(226, 232, 240, 0.9)",
    fontWeight: 600,
  };

  const badgeStyles: CSSProperties = {
    borderRadius: "999px",
    border: "1px solid",
    padding: "4px 12px",
    fontSize: "12px",
    fontWeight: 600,
  };

  const badgeFirmStyles: CSSProperties = {
    ...badgeStyles,
    borderColor: "rgba(125, 211, 252, 0.4)",
    background: "rgba(125, 211, 252, 0.1)",
    color: "rgba(186, 230, 253, 0.9)",
  };

  const badgeViewOnlyStyles: CSSProperties = {
    ...badgeStyles,
    borderColor: "rgba(196, 181, 253, 0.4)",
    background: "rgba(196, 181, 253, 0.1)",
    color: "rgba(221, 214, 254, 0.9)",
  };

  const errorCardStyles: CSSProperties = {
    borderRadius: "14px",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    background: "rgba(127, 29, 29, 0.6)",
    padding: "12px 16px",
    fontSize: "14px",
  };

  const errorTitleStyles: CSSProperties = {
    fontWeight: 500,
    color: "rgba(254, 226, 226, 0.9)",
    marginBottom: "4px",
  };

  const errorTextStyles: CSSProperties = {
    marginTop: "4px",
    color: "rgba(254, 226, 226, 0.8)",
    fontSize: "14px",
  };

  const labelStyles: CSSProperties = {
    display: "block",
    fontSize: "14px",
    fontWeight: 500,
    color: "rgba(226, 232, 240, 0.9)",
    marginBottom: "8px",
  };

  const inputStyles: CSSProperties = {
    width: "100%",
    marginTop: "8px",
    borderRadius: "14px",
    border: "1px solid rgba(71, 85, 105, 0.5)",
    background: "rgba(15, 23, 42, 0.6)",
    padding: "8px 12px",
    fontSize: "14px",
    color: "#f1f5f9",
    outline: "none",
    transition:
      "border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease",
  };

  const inputDisabledStyles: CSSProperties = {
    ...inputStyles,
    cursor: "not-allowed",
    borderColor: "rgba(51, 65, 85, 0.5)",
    background: "rgba(15, 23, 42, 0.3)",
    opacity: 0.6,
  };

  const textareaStyles: CSSProperties = {
    ...inputStyles,
    fontFamily: "inherit",
    resize: "vertical" as const,
    lineHeight: 1.6,
    minHeight: "400px",
  };

  const textareaDisabledStyles: CSSProperties = {
    ...textareaStyles,
    ...inputDisabledStyles,
  };

  const helpTextStyles: CSSProperties = {
    marginTop: "8px",
    fontSize: "12px",
    color: "rgba(148, 163, 184, 0.8)",
  };

  const formFooterStyles: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  };

  const cancelLinkStyles: CSSProperties = {
    fontSize: "14px",
    fontWeight: 500,
    color: "rgba(203, 213, 225, 0.9)",
    textDecoration: "none",
    transition: "color 0.2s ease",
  };

  const submitButtonStyles: CSSProperties = {
    borderRadius: "14px",
    background: "linear-gradient(135deg, #10b981, #059669)",
    border: "none",
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: 600,
    color: "#052e16",
    cursor: "pointer",
    boxShadow: "0 18px 30px -20px rgba(16, 185, 129, 0.55)",
    transition: "transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const submitButtonDisabledStyles: CSSProperties = {
    ...submitButtonStyles,
    background: "rgba(51, 65, 85, 0.8)",
    color: "rgba(148, 163, 184, 0.8)",
    cursor: "not-allowed",
    boxShadow: "none",
    opacity: 0.6,
  };

  const readonlyTextStyles: CSSProperties = {
    fontSize: "12px",
    color: "rgba(148, 163, 184, 0.8)",
  };

  return (
    <div style={pageStyles}>
      <header style={headerStyles}>
        <div style={headerContainerStyles}>
          <div style={breadcrumbStyles}>
            <Link
              to="/templates"
              style={breadcrumbLinkStyles}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#34d399";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "#6ee7b7";
              }}
            >
              Templates
            </Link>
            <span style={breadcrumbSeparatorStyles}>/</span>
            <span>{headerTitle}</span>
          </div>
          <h1 style={titleStyles}>{headerTitle}</h1>
          <p style={subtitleStyles}>
            {isNew
              ? "Draft a reusable template to jump-start future demand letters."
              : "Review the template content and make updates if you own it."}
          </p>
        </div>
      </header>

      <main style={mainStyles}>
        {loading ? (
          <div style={loadingContainerStyles}>
            <div
              style={{ ...loadingBoxStyles, height: "32px", width: "160px" }}
            />
            <div
              style={{ ...loadingBoxStyles, height: "48px", width: "100%" }}
            />
            <div
              style={{ ...loadingBoxStyles, height: "576px", width: "100%" }}
            />
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={formStyles}>
            {templateMeta && (
              <div style={metaStyles}>
                <span>
                  Created{" "}
                  <strong style={metaStrongStyles}>
                    {new Date(templateMeta.createdAt).toLocaleString()}
                  </strong>
                </span>
                <span>
                  Updated{" "}
                  <strong style={metaStrongStyles}>
                    {new Date(templateMeta.updatedAt).toLocaleString()}
                  </strong>
                </span>
                {templateMeta.isGlobal && (
                  <span style={badgeFirmStyles}>Firm-wide</span>
                )}
                {!templateMeta.isOwner && (
                  <span style={badgeViewOnlyStyles}>View only</span>
                )}
              </div>
            )}

            {error && (
              <div style={errorCardStyles}>
                <p style={errorTitleStyles}>Save failed</p>
                <p style={errorTextStyles}>{error}</p>
              </div>
            )}

            <div>
              <label htmlFor="title" style={labelStyles}>
                Template title
              </label>
              <input
                id="title"
                name="title"
                type="text"
                value={title}
                disabled={!canEdit}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={255}
                style={!canEdit ? inputDisabledStyles : inputStyles}
                placeholder="Demand letter template name"
                onFocus={(e) => {
                  if (canEdit) {
                    e.currentTarget.style.borderColor =
                      "rgba(16, 185, 129, 0.8)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(16, 185, 129, 0.2)";
                  }
                }}
                onBlur={(e) => {
                  if (canEdit) {
                    e.currentTarget.style.borderColor =
                      "rgba(71, 85, 105, 0.5)";
                    e.currentTarget.style.boxShadow = "none";
                  }
                }}
              />
            </div>

            <div>
              <label htmlFor="content" style={labelStyles}>
                Template content
              </label>
              <textarea
                id="content"
                name="content"
                value={content}
                disabled={!canEdit}
                onChange={(event) => setContent(event.target.value)}
                required
                rows={18}
                style={!canEdit ? textareaDisabledStyles : textareaStyles}
                placeholder="Draft the master content for this template. Include headings, merge fields, and guidance for AI."
                onFocus={(e) => {
                  if (canEdit) {
                    e.currentTarget.style.borderColor =
                      "rgba(16, 185, 129, 0.8)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(16, 185, 129, 0.2)";
                  }
                }}
                onBlur={(e) => {
                  if (canEdit) {
                    e.currentTarget.style.borderColor =
                      "rgba(71, 85, 105, 0.5)";
                    e.currentTarget.style.boxShadow = "none";
                  }
                }}
              />
              <p style={helpTextStyles}>
                For merge fields use bracketed notation, e.g. {"{client_name}"}{" "}
                or {"{accident_date}"}.
              </p>
            </div>

            <div style={formFooterStyles}>
              <Link
                to="/templates"
                style={cancelLinkStyles}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#f8fafc";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "rgba(203, 213, 225, 0.9)";
                }}
              >
                Cancel
              </Link>
              {canEdit ? (
                <button
                  type="submit"
                  disabled={saving}
                  style={
                    saving ? submitButtonDisabledStyles : submitButtonStyles
                  }
                  onMouseEnter={(e) => {
                    if (!saving) {
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.boxShadow =
                        "0 22px 35px -22px rgba(16, 185, 129, 0.65)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!saving) {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow =
                        "0 18px 30px -20px rgba(16, 185, 129, 0.55)";
                    }
                  }}
                >
                  {saving
                    ? "Saving…"
                    : isNew
                    ? "Create template"
                    : "Save changes"}
                </button>
              ) : (
                <p style={readonlyTextStyles}>
                  Only the template owner can modify this content.
                </p>
              )}
            </div>
          </form>
        )}
      </main>
    </div>
  );
};

export default TemplateEditor;

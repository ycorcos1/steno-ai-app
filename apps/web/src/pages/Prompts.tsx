import axios from "axios";
import { CSSProperties, FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { authApi } from "../lib/auth";

interface Prompt {
  id: string;
  name: string;
  body: string;
  createdAt: string;
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

const Prompts: React.FC = () => {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState<boolean>(false);
  const [formName, setFormName] = useState<string>("");
  const [formBody, setFormBody] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchPrompts = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await authApi.get("/prompts");
      const data = response.data as { prompts?: Prompt[] };
      setPrompts(data.prompts ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPrompts();
  }, []);

  const handleCreate = () => {
    setShowCreateForm(true);
    setEditingId(null);
    setFormName("");
    setFormBody("");
    setFormError(null);
  };

  const handleEdit = (prompt: Prompt) => {
    setEditingId(prompt.id);
    setShowCreateForm(false);
    setFormName(prompt.name);
    setFormBody(prompt.body);
    setFormError(null);
  };

  const handleCancel = () => {
    setShowCreateForm(false);
    setEditingId(null);
    setFormName("");
    setFormBody("");
    setFormError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    if (!formName.trim() || !formBody.trim()) {
      setFormError("Name and body are required");
      return;
    }

    try {
      setSaving(true);
      setFormError(null);

      if (editingId) {
        // Update existing
        await authApi.put(`/prompts/${editingId}`, {
          name: formName,
          body: formBody,
        });
      } else {
        // Create new
        await authApi.post("/prompts", {
          name: formName,
          body: formBody,
        });
      }

      // Refresh list
      await fetchPrompts();
      handleCancel();
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this prompt?")) {
      return;
    }

    try {
      setDeletingId(id);
      await authApi.delete(`/prompts/${id}`);
      await fetchPrompts();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

  // Inline CSS styles matching theme
  const pageStyles: CSSProperties = {
    minHeight: "100vh",
    background: "radial-gradient(circle at 15% 15%, #1e293b, #0f172a 65%)",
    color: "#e2e8f0",
    fontFamily:
      "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  };

  const navStyles: CSSProperties = {
    borderBottom: "1px solid rgba(71, 85, 105, 0.35)",
    background: "rgba(15, 23, 42, 0.55)",
    backdropFilter: "blur(12px)",
  };

  const navContainerStyles: CSSProperties = {
    maxWidth: "1280px",
    margin: "0 auto",
    padding: "0 24px",
    height: "64px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  const navLinkStyles: CSSProperties = {
    fontSize: "18px",
    fontWeight: 700,
    color: "#f1f5f9",
    textDecoration: "none",
    transition: "color 0.2s ease",
  };

  const navTitleStyles: CSSProperties = {
    fontSize: "24px",
    fontWeight: 700,
    color: "#f8fafc",
  };

  const mainStyles: CSSProperties = {
    maxWidth: "896px",
    margin: "0 auto",
    padding: "32px 24px",
  };

  const errorCardStyles: CSSProperties = {
    marginBottom: "24px",
    borderRadius: "14px",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    background: "rgba(127, 29, 29, 0.6)",
    padding: "16px",
    fontSize: "14px",
    color: "rgba(248, 113, 113, 0.9)",
  };

  const headerStyles: CSSProperties = {
    marginBottom: "24px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  const headerTextStyles: CSSProperties = {
    color: "rgba(148, 163, 184, 0.8)",
    fontSize: "14px",
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
  };

  const formCardStyles: CSSProperties = {
    marginBottom: "24px",
    borderRadius: "22px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.75))",
    boxShadow:
      "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
    padding: "24px",
  };

  const formTitleStyles: CSSProperties = {
    marginBottom: "16px",
    fontSize: "20px",
    fontWeight: 700,
    color: "#f8fafc",
  };

  const formErrorStyles: CSSProperties = {
    marginBottom: "16px",
    borderRadius: "14px",
    border: "1px solid rgba(239, 68, 68, 0.4)",
    background: "rgba(127, 29, 29, 0.6)",
    padding: "12px",
    fontSize: "14px",
    color: "rgba(248, 113, 113, 0.9)",
  };

  const formStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  };

  const labelStyles: CSSProperties = {
    display: "block",
    fontSize: "14px",
    fontWeight: 600,
    color: "rgba(203, 213, 225, 0.9)",
    marginBottom: "4px",
  };

  const inputStyles: CSSProperties = {
    width: "100%",
    marginTop: "4px",
    borderRadius: "14px",
    border: "1px solid rgba(71, 85, 105, 0.5)",
    background: "rgba(15, 23, 42, 0.6)",
    padding: "8px 12px",
    fontSize: "14px",
    color: "#f1f5f9",
    outline: "none",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  };

  const textareaStyles: CSSProperties = {
    ...inputStyles,
    fontFamily: "inherit",
    resize: "vertical" as const,
  };

  const buttonGroupStyles: CSSProperties = {
    display: "flex",
    gap: "12px",
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
  };

  const cancelButtonStyles: CSSProperties = {
    borderRadius: "14px",
    border: "1px solid rgba(71, 85, 105, 0.5)",
    background: "rgba(30, 41, 59, 0.6)",
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: 600,
    color: "rgba(203, 213, 225, 0.9)",
    cursor: "pointer",
    transition: "background 0.2s ease",
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

  const emptyStateTextStyles: CSSProperties = {
    color: "rgba(148, 163, 184, 0.8)",
    fontSize: "14px",
  };

  const promptCardStyles: CSSProperties = {
    borderRadius: "22px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.75))",
    boxShadow:
      "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
    padding: "20px",
    transition: "border-color 0.2s ease",
  };

  const promptCardContentStyles: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
  };

  const promptContentStyles: CSSProperties = {
    flex: 1,
  };

  const promptTitleStyles: CSSProperties = {
    fontSize: "18px",
    fontWeight: 600,
    color: "#f8fafc",
    marginBottom: "8px",
  };

  const promptBodyStyles: CSSProperties = {
    marginTop: "8px",
    fontSize: "14px",
    color: "rgba(148, 163, 184, 0.8)",
    whiteSpace: "pre-wrap" as const,
    lineHeight: 1.6,
  };

  const promptDateStyles: CSSProperties = {
    marginTop: "12px",
    fontSize: "12px",
    color: "rgba(100, 116, 139, 0.8)",
  };

  const promptActionsStyles: CSSProperties = {
    marginLeft: "16px",
    display: "flex",
    gap: "8px",
  };

  const editButtonStyles: CSSProperties = {
    borderRadius: "8px",
    background: "rgba(51, 65, 85, 0.8)",
    border: "none",
    padding: "4px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "rgba(226, 232, 240, 0.9)",
    cursor: "pointer",
    transition: "background 0.2s ease",
  };

  const deleteButtonStyles: CSSProperties = {
    borderRadius: "8px",
    background: "rgba(239, 68, 68, 0.2)",
    border: "none",
    padding: "4px 12px",
    fontSize: "12px",
    fontWeight: 600,
    color: "rgba(248, 113, 113, 0.9)",
    cursor: "pointer",
    transition: "background 0.2s ease, opacity 0.2s ease",
  };

  const promptsListStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  };

  return (
    <div style={pageStyles}>
      <nav style={navStyles}>
        <div style={navContainerStyles}>
          <Link
            to="/dashboard"
            style={navLinkStyles}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#6ee7b7";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "#f1f5f9";
            }}
          >
            ← Dashboard
          </Link>
          <h1 style={navTitleStyles}>Custom Prompts</h1>
          <div style={{ width: "96px" }}></div>
        </div>
      </nav>

      <main style={mainStyles}>
        {error && (
          <div style={errorCardStyles}>
            <p>{error}</p>
          </div>
        )}

        <div style={headerStyles}>
          <p style={headerTextStyles}>
            Create reusable prompts for draft generation and refinement.
          </p>
          {!showCreateForm && !editingId && (
            <button
              onClick={handleCreate}
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
              + New Prompt
            </button>
          )}
        </div>

        {(showCreateForm || editingId) && (
          <div style={formCardStyles}>
            <h2 style={formTitleStyles}>
              {editingId ? "Edit Prompt" : "Create New Prompt"}
            </h2>
            {formError && <div style={formErrorStyles}>{formError}</div>}
            <form onSubmit={handleSubmit} style={formStyles}>
              <div>
                <label htmlFor="prompt-name" style={labelStyles}>
                  Name
                </label>
                <input
                  id="prompt-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g., Formal Legal Tone"
                  style={inputStyles}
                  required
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor =
                      "rgba(16, 185, 129, 0.8)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(16, 185, 129, 0.2)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor =
                      "rgba(71, 85, 105, 0.5)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
              </div>
              <div>
                <label htmlFor="prompt-body" style={labelStyles}>
                  Prompt Body
                </label>
                <textarea
                  id="prompt-body"
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  placeholder="Describe the changes or tone you want the AI to apply..."
                  rows={4}
                  style={textareaStyles}
                  required
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor =
                      "rgba(16, 185, 129, 0.8)";
                    e.currentTarget.style.boxShadow =
                      "0 0 0 3px rgba(16, 185, 129, 0.2)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor =
                      "rgba(71, 85, 105, 0.5)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
              </div>
              <div style={buttonGroupStyles}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    ...submitButtonStyles,
                    opacity: saving ? 0.5 : 1,
                    cursor: saving ? "not-allowed" : "pointer",
                  }}
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
                  {saving ? "Saving..." : editingId ? "Update" : "Create"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  style={cancelButtonStyles}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(30, 41, 59, 0.8)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(30, 41, 59, 0.6)";
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div style={emptyStateStyles}>
            <p style={emptyStateTextStyles}>Loading prompts...</p>
          </div>
        ) : prompts.length === 0 ? (
          <div style={emptyStateStyles}>
            <p style={emptyStateTextStyles}>
              No custom prompts yet. Create one to get started!
            </p>
          </div>
        ) : (
          <div style={promptsListStyles}>
            {prompts.map((prompt) => (
              <div
                key={prompt.id}
                style={promptCardStyles}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor =
                    "rgba(148, 163, 184, 0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor =
                    "rgba(148, 163, 184, 0.18)";
                }}
              >
                <div style={promptCardContentStyles}>
                  <div style={promptContentStyles}>
                    <h3 style={promptTitleStyles}>{prompt.name}</h3>
                    <p style={promptBodyStyles}>{prompt.body}</p>
                    <p style={promptDateStyles}>
                      Created {formatDate(prompt.createdAt)}
                    </p>
                  </div>
                  <div style={promptActionsStyles}>
                    <button
                      onClick={() => handleEdit(prompt)}
                      style={editButtonStyles}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background =
                          "rgba(51, 65, 85, 1)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background =
                          "rgba(51, 65, 85, 0.8)";
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void handleDelete(prompt.id)}
                      disabled={deletingId === prompt.id}
                      style={{
                        ...deleteButtonStyles,
                        opacity: deletingId === prompt.id ? 0.5 : 1,
                        cursor:
                          deletingId === prompt.id ? "not-allowed" : "pointer",
                      }}
                      onMouseEnter={(e) => {
                        if (deletingId !== prompt.id) {
                          e.currentTarget.style.background =
                            "rgba(239, 68, 68, 0.3)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (deletingId !== prompt.id) {
                          e.currentTarget.style.background =
                            "rgba(239, 68, 68, 0.2)";
                        }
                      }}
                    >
                      {deletingId === prompt.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Prompts;

import axios from "axios";
import {
  CSSProperties,
  ChangeEvent,
  FormEvent,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../lib/auth";

type UploadPhase =
  | "idle"
  | "requesting"
  | "uploading"
  | "ingesting"
  | "completed";

interface Step {
  label: string;
  key: UploadPhase;
  description: string;
}

const steps: Step[] = [
  {
    key: "idle",
    label: "Select File",
    description: "Choose a PDF, DOCX, or TXT file from your device.",
  },
  {
    key: "requesting",
    label: "Create Upload Slot",
    description: "Securely reserving space in S3.",
  },
  {
    key: "uploading",
    label: "Upload to S3",
    description: "Sending the file to encrypted storage.",
  },
  {
    key: "ingesting",
    label: "Process & Extract Text",
    description: "Extracting text and preparing document workspace.",
  },
  {
    key: "completed",
    label: "Ready in Editor",
    description: "Redirecting you to the document editor.",
  },
];

const fallbackMime = "application/octet-stream";

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

const Upload: React.FC = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const allowedTypes = useMemo(
    () => [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/plain",
    ],
    []
  );

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setError(null);
    setPhase("idle");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!file) {
      setError("Please choose a document to upload.");
      return;
    }

    const contentType = file.type || fallbackMime;
    if (file.type && !allowedTypes.includes(file.type)) {
      setError(
        "Unsupported file type. Please upload a PDF, DOCX, DOC, or TXT."
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      setPhase("requesting");

      const uploadUrlResponse = await authApi.post("/documents/upload-url", {
        contentType,
        fileName: file.name,
      });

      const { uploadUrl, key } = uploadUrlResponse.data as {
        uploadUrl: string;
        key: string;
      };

      setPhase("uploading");

      const uploadResult = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
        },
        body: file,
      });

      if (!uploadResult.ok) {
        throw new Error(
          `Upload failed with status ${uploadResult.status}. Please retry.`
        );
      }

      setPhase("ingesting");

      const ingestResponse = await authApi.post("/documents/ingest", {
        key,
        originalName: file.name,
        mime: contentType ?? fallbackMime,
        size: file.size,
      });

      const { documentId } = ingestResponse.data as { documentId: string };

      setPhase("completed");
      navigate(`/documents/${documentId}`, { replace: true });
    } catch (err) {
      console.error("Upload flow failed:", err);
      setError(getErrorMessage(err));
      setPhase("idle");
    } finally {
      setIsSubmitting(false);
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
    display: "flex",
    flexDirection: "column",
    gap: "32px",
  };

  const cardStyles: CSSProperties = {
    borderRadius: "22px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.75))",
    boxShadow:
      "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
    padding: "24px",
  };

  const formStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  };

  const labelStyles: CSSProperties = {
    display: "block",
    fontSize: "14px",
    fontWeight: 500,
    color: "rgba(226, 232, 240, 0.9)",
    marginBottom: "8px",
  };

  const inputContainerStyles: CSSProperties = {
    marginTop: "8px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  };

  const fileInputStyles: CSSProperties = {
    width: "100%",
    borderRadius: "14px",
    border: "1px solid rgba(71, 85, 105, 0.5)",
    background: "rgba(15, 23, 42, 0.6)",
    padding: "8px 12px",
    fontSize: "14px",
    color: "rgba(226, 232, 240, 0.9)",
    outline: "none",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  };

  const buttonStyles: CSSProperties = {
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
  };

  const buttonDisabledStyles: CSSProperties = {
    ...buttonStyles,
    background: "rgba(51, 65, 85, 0.8)",
    color: "rgba(148, 163, 184, 0.8)",
    cursor: "not-allowed",
    boxShadow: "none",
  };

  const helpTextStyles: CSSProperties = {
    marginTop: "8px",
    fontSize: "12px",
    color: "rgba(148, 163, 184, 0.8)",
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
    color: "rgba(254, 226, 226, 0.8)",
    fontSize: "14px",
  };

  const infoCardStyles: CSSProperties = {
    borderRadius: "14px",
    border: "1px solid rgba(71, 85, 105, 0.35)",
    background: "rgba(30, 41, 59, 0.5)",
    padding: "12px 16px",
    fontSize: "14px",
    color: "rgba(203, 213, 225, 0.9)",
  };

  const infoTitleStyles: CSSProperties = {
    fontWeight: 500,
    color: "rgba(226, 232, 240, 0.9)",
    marginBottom: "4px",
  };

  const infoSubtextStyles: CSSProperties = {
    marginTop: "4px",
    fontSize: "12px",
    color: "rgba(148, 163, 184, 0.8)",
  };

  const statusSectionStyles: CSSProperties = {
    ...cardStyles,
    background:
      "linear-gradient(180deg, rgba(17, 24, 39, 0.75), rgba(17, 24, 39, 0.6))",
  };

  const statusTitleStyles: CSSProperties = {
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "rgba(148, 163, 184, 0.8)",
    marginBottom: "16px",
  };

  const statusListStyles: CSSProperties = {
    marginTop: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    listStyle: "none",
    padding: 0,
    fontSize: "14px",
  };

  const statusItemStyles: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    borderRadius: "14px",
    border: "1px solid transparent",
    padding: "12px",
  };

  const statusItemActiveStyles: CSSProperties = {
    ...statusItemStyles,
    border: "1px solid rgba(16, 185, 129, 0.4)",
    background: "rgba(16, 185, 129, 0.1)",
  };

  const statusDotStyles: CSSProperties = {
    marginTop: "4px",
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    flexShrink: 0,
  };

  const statusDotCompletedStyles: CSSProperties = {
    ...statusDotStyles,
    background: "rgba(110, 231, 183, 0.9)",
  };

  const statusDotPendingStyles: CSSProperties = {
    ...statusDotStyles,
    background: "rgba(51, 65, 85, 0.8)",
  };

  const statusLabelStyles: CSSProperties = {
    fontWeight: 500,
    color: "#f8fafc",
    marginBottom: "4px",
  };

  const statusDescriptionStyles: CSSProperties = {
    fontSize: "12px",
    color: "rgba(148, 163, 184, 0.8)",
  };

  return (
    <div style={pageStyles}>
      <header style={headerStyles}>
        <div style={headerContainerStyles}>
          <h1 style={titleStyles}>Upload Document</h1>
          <p style={subtitleStyles}>
            Securely upload client materials to start drafting in the unified
            editor. Supported formats: PDF, DOCX, DOC, TXT.
          </p>
        </div>
      </header>

      <main style={mainStyles}>
        <section style={cardStyles}>
          <form onSubmit={handleSubmit} style={formStyles}>
            <div>
              <label htmlFor="document" style={labelStyles}>
                Choose file
              </label>
              <div style={inputContainerStyles}>
                <input
                  id="document"
                  type="file"
                  accept=".pdf,.docx,.doc,.txt"
                  style={fileInputStyles}
                  onChange={handleFileChange}
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
                <button
                  type="submit"
                  disabled={!file || isSubmitting}
                  style={
                    !file || isSubmitting ? buttonDisabledStyles : buttonStyles
                  }
                  onMouseEnter={(e) => {
                    if (!(!file || isSubmitting)) {
                      e.currentTarget.style.transform = "translateY(-2px)";
                      e.currentTarget.style.boxShadow =
                        "0 22px 35px -22px rgba(16, 185, 129, 0.65)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!(!file || isSubmitting)) {
                      e.currentTarget.style.transform = "translateY(0)";
                      e.currentTarget.style.boxShadow =
                        "0 18px 30px -20px rgba(16, 185, 129, 0.55)";
                    }
                  }}
                >
                  {isSubmitting ? "Uploading…" : "Start Upload"}
                </button>
              </div>
              <p style={helpTextStyles}>
                Files stay private within your firm. Max size: 25 MB.
              </p>
            </div>

            {error ? (
              <div style={errorCardStyles}>
                <p style={errorTitleStyles}>Upload failed</p>
                <p style={errorTextStyles}>{error}</p>
              </div>
            ) : (
              <div style={infoCardStyles}>
                <p style={infoTitleStyles}>
                  {file
                    ? `Ready to upload ${file.name} (${Math.round(
                        file.size / 1024
                      )} KB)`
                    : "Select a document to begin the upload process."}
                </p>
                <p style={infoSubtextStyles}>
                  You can navigate away after the upload completes; ingestion
                  runs automatically.
                </p>
              </div>
            )}
          </form>
        </section>

        <section style={statusSectionStyles}>
          <h2 style={statusTitleStyles}>Upload status</h2>
          <ol style={statusListStyles}>
            {steps.map((step) => {
              const isActive = step.key === phase;
              const isCompleted =
                steps.findIndex((s) => s.key === step.key) <=
                steps.findIndex((s) => s.key === phase);
              return (
                <li
                  key={step.key}
                  style={isActive ? statusItemActiveStyles : statusItemStyles}
                >
                  <span
                    style={
                      isCompleted
                        ? statusDotCompletedStyles
                        : statusDotPendingStyles
                    }
                  />
                  <div>
                    <p style={statusLabelStyles}>{step.label}</p>
                    <p style={statusDescriptionStyles}>{step.description}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </main>
    </div>
  );
};

export default Upload;

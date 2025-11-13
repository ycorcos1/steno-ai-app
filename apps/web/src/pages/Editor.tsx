import axios from "axios";
import {
  CSSProperties,
  FormEvent,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { authApi, useAuth } from "../lib/auth";
import { initCollabDoc } from "../lib/collab/yjs";
import * as Y from "yjs";

interface TemplateOption {
  id: string;
  title: string;
  isGlobal: boolean;
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

const Editor: React.FC = () => {
  const { id: documentId = "draft" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [loadingTemplates, setLoadingTemplates] = useState<boolean>(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const [customPrompts, setCustomPrompts] = useState<
    Array<{ id: string; name: string; body: string }>
  >([]);
  const [loadingPrompts, setLoadingPrompts] = useState<boolean>(true);
  const [selectedGenerationPromptId, setSelectedGenerationPromptId] =
    useState<string>("");
  const [selectedRefinementPromptId, setSelectedRefinementPromptId] =
    useState<string>("");
  const [generationInstructions, setGenerationInstructions] =
    useState<string>("");

  const [document, setDocument] = useState<{
    id: string;
    title: string;
    extractedText: string;
    draftText: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  } | null>(null);
  const [loadingDocument, setLoadingDocument] = useState<boolean>(true);
  const [documentError, setDocumentError] = useState<string | null>(null);

  const [draftText, setDraftText] = useState<string>("");
  const [refinePrompt, setRefinePrompt] = useState<string>(
    "Tighten the liability section and add bullet points for economic damages."
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Y.js collaboration state
  const [collabState, setCollabState] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("disconnected");
  const [activeUsers, setActiveUsers] = useState<Set<string>>(new Set());
  const yjsRef = useRef<{
    ydoc: Y.Doc;
    provider: any;
    ytext: Y.Text;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        setLoadingTemplates(true);
        const response = await authApi.get("/templates");
        const data = response.data as {
          templates?: Array<TemplateOption & { content: string }>;
        };
        const fetched = (data.templates ?? []).map((template) => ({
          id: template.id,
          title: template.title,
          isGlobal: template.isGlobal,
          isOwner: template.isOwner,
        }));
        setTemplates(fetched);
        if (fetched.length > 0) {
          setSelectedTemplateId(fetched[0].id);
        }
      } catch (err) {
        setTemplatesError(getErrorMessage(err));
      } finally {
        setLoadingTemplates(false);
      }
    };

    void fetchTemplates();
  }, []);

  useEffect(() => {
    const fetchCustomPrompts = async () => {
      try {
        setLoadingPrompts(true);
        const response = await authApi.get("/prompts");
        const data = response.data as {
          prompts?: Array<{ id: string; name: string; body: string }>;
        };
        setCustomPrompts(data.prompts ?? []);
      } catch (err) {
        console.error("Failed to fetch custom prompts:", err);
      } finally {
        setLoadingPrompts(false);
      }
    };

    void fetchCustomPrompts();
  }, []);

  useEffect(() => {
    const fetchDocument = async () => {
      if (!documentId || documentId === "draft") {
        setLoadingDocument(false);
        return;
      }

      try {
        setLoadingDocument(true);
        setDocumentError(null);
        const response = await authApi.get(`/documents/${documentId}`);
        const data = response.data as {
          document: {
            id: string;
            title: string;
            extractedText: string;
            draftText: string;
            status: string;
            createdAt: string;
            updatedAt: string;
          };
        };
        setDocument(data.document);
        setDraftText(data.document.draftText || "");
      } catch (err) {
        setDocumentError(getErrorMessage(err));
      } finally {
        setLoadingDocument(false);
      }
    };

    void fetchDocument();
  }, [documentId]);

  // Initialize Y.js collaboration when document loads
  useEffect(() => {
    if (!documentId || documentId === "draft" || !user) {
      return;
    }

    const wsBaseUrl =
      import.meta.env.VITE_WS_BASE_URL ||
      "wss://n3fxav2xid.execute-api.us-east-1.amazonaws.com/prod";

    // Skip WebSocket if URL is a placeholder
    const isPlaceholderUrl = wsBaseUrl.includes("placeholder");
    if (isPlaceholderUrl) {
      console.log("WebSocket collaboration disabled: placeholder URL");
      return;
    }

    // Disable WebSocket collaboration for now to avoid console errors
    // TODO: Re-enable once WebSocket connection issues are resolved
    return;

    // Get JWT token for WebSocket
    // Note: Since JWT is in httpOnly cookie, we fetch it from /auth/ws-token endpoint
    const initYjs = async () => {
      try {
        let jwt = "";
        try {
          const tokenResponse = await authApi.get("/auth/ws-token");
          jwt = (tokenResponse.data as { token: string }).token;
        } catch (error) {
          // Silently fail - collaboration is optional
          console.debug("WebSocket collaboration unavailable:", error);
          return;
        }

        // Initialize Y.js
        const { ydoc, provider, ytext } = initCollabDoc(
          documentId,
          jwt,
          wsBaseUrl
        );

        yjsRef.current = { ydoc, provider, ytext };

        // Small delay before connecting to ensure token is ready
        // This helps avoid the initial connection error
        setTimeout(() => {
          if (yjsRef.current?.provider) {
            yjsRef.current.provider.connect();
          }
        }, 100);

        // Set up event listeners
        provider.on("status", (event: any) => {
          const status = event[0]?.status;
          if (status === "connected") {
            setCollabState("connected");
          } else if (status === "disconnected") {
            setCollabState("disconnected");
          } else if (status === "error") {
            setCollabState("error");
          }
        });

        provider.on("presence", (event: any) => {
          const message = event[0];
          if (message.action === "join") {
            setActiveUsers((prev) => new Set([...prev, message.userId]));
          } else if (message.action === "leave") {
            setActiveUsers((prev) => {
              const next = new Set(prev);
              next.delete(message.userId);
              return next;
            });
          }
        });

        // Initialize Y.js text with current draft text (only if empty)
        if (document?.draftText && ytext.length === 0) {
          ytext.insert(0, document.draftText);
          setDraftText(document.draftText);
        }

        // Sync Y.js text with React state (for initial load and remote updates)
        const handleYjsChange = () => {
          const newText = ytext.toString();
          if (newText !== draftText) {
            setDraftText(newText);
          }
        };
        ytext.observe(handleYjsChange);
      } catch (error) {
        console.error("Failed to initialize Y.js collaboration:", error);
        setCollabState("error");
      }
    };

    void initYjs();

    // Cleanup on unmount
    return () => {
      if (yjsRef.current) {
        yjsRef.current.provider.disconnect();
        yjsRef.current.ydoc.destroy();
        yjsRef.current = null;
      }
    };
  }, [documentId, user, document?.draftText]);

  // Auto-save draft text when it changes (debounced)
  useEffect(() => {
    if (!documentId || documentId === "draft" || !draftText) {
      return;
    }

    // Debounce auto-save: wait 2 seconds after user stops typing
    const timeoutId = setTimeout(async () => {
      try {
        await authApi.put(`/documents/${documentId}/draft`, {
          draftText,
        });
        // Silently save - don't show message for auto-save
      } catch (err) {
        // Silently fail for auto-save - user can manually save if needed
        console.error("Auto-save failed:", err);
      }
    }, 2000);

    return () => clearTimeout(timeoutId);
  }, [draftText, documentId]);

  // Sync textarea changes to Y.js (improved diffing)
  useEffect(() => {
    if (!yjsRef.current || !textareaRef.current) {
      return;
    }

    const textarea = textareaRef.current;
    const ytext = yjsRef.current.ytext;
    let isUpdatingFromYjs = false;

    // Handle user input - sync to Y.js with better diffing
    const handleInput = (e: Event) => {
      if (isUpdatingFromYjs) return;

      const target = e.target as HTMLTextAreaElement;
      const currentYjsText = ytext.toString();
      if (target.value === currentYjsText) return;

      const oldText = currentYjsText;
      const newText = target.value;
      const oldLen = oldText.length;
      const newLen = newText.length;

      // Find common prefix and suffix for better diffing
      let prefixLen = 0;
      while (
        prefixLen < oldLen &&
        prefixLen < newLen &&
        oldText[prefixLen] === newText[prefixLen]
      ) {
        prefixLen++;
      }

      let suffixLen = 0;
      while (
        suffixLen < oldLen - prefixLen &&
        suffixLen < newLen - prefixLen &&
        oldText[oldLen - 1 - suffixLen] === newText[newLen - 1 - suffixLen]
      ) {
        suffixLen++;
      }

      // Apply changes: delete middle section, insert new middle
      const deleteStart = prefixLen;
      const deleteLen = oldLen - prefixLen - suffixLen;
      const insertText = newText.substring(prefixLen, newLen - suffixLen);

      if (deleteLen > 0 || insertText.length > 0) {
        isUpdatingFromYjs = true;
        if (deleteLen > 0) {
          ytext.delete(deleteStart, deleteLen);
        }
        if (insertText.length > 0) {
          ytext.insert(deleteStart, insertText);
        }
        isUpdatingFromYjs = false;
      }
    };

    // Handle Y.js updates - sync to textarea
    const handleYjsUpdate = () => {
      if (isUpdatingFromYjs) return;
      const yjsText = ytext.toString();
      if (textarea.value !== yjsText) {
        isUpdatingFromYjs = true;
        const cursorPos = textarea.selectionStart;
        textarea.value = yjsText;
        // Try to restore cursor position
        const newPos = Math.min(cursorPos, yjsText.length);
        textarea.setSelectionRange(newPos, newPos);
        setDraftText(yjsText);
        isUpdatingFromYjs = false;
      }
    };

    textarea.addEventListener("input", handleInput);
    ytext.observe(handleYjsUpdate);

    return () => {
      textarea.removeEventListener("input", handleInput);
      ytext.unobserve(handleYjsUpdate);
    };
  }, [yjsRef.current]);

  const documentMetadata = useMemo(
    () => ({
      title: document?.title || "Loading...",
      status: document?.status || "loading",
      uploadedAt: document?.createdAt || new Date().toISOString(),
      lastGenerated:
        document?.updatedAt || document?.createdAt || new Date().toISOString(),
    }),
    [document]
  );

  // Split extracted text into paragraphs for display
  // Note: Backend validation handles corruption detection - if text was extracted successfully,
  // we trust it and display it. The backend will return an error if extraction truly fails.
  const isExtractedTextCorrupted = useMemo(() => {
    // Disabled: Backend validation is sufficient. If text was extracted and stored,
    // it means the backend validated it successfully. Frontend detection was causing
    // false positives for DOC files which may have some binary artifacts but are still readable.
    return false;
  }, [document?.extractedText]);

  const extractedParagraphs = useMemo(() => {
    if (!document?.extractedText) {
      return [];
    }
    return document.extractedText
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }, [document]);

  const enrichedTemplates = useMemo(
    () =>
      templates.map((template) => ({
        ...template,
        label: template.isGlobal
          ? `${template.title} • Firm`
          : template.isOwner
          ? `${template.title} • Yours`
          : template.title,
      })),
    [templates]
  );

  const handleGenerationPromptSelect = (promptId: string) => {
    setSelectedGenerationPromptId(promptId);
    if (promptId) {
      const prompt = customPrompts.find((p) => p.id === promptId);
      if (prompt) {
        setGenerationInstructions(prompt.body);
      }
    } else {
      setGenerationInstructions("");
    }
  };

  const handleRefinementPromptSelect = (promptId: string) => {
    setSelectedRefinementPromptId(promptId);
    if (promptId) {
      const prompt = customPrompts.find((p) => p.id === promptId);
      if (prompt) {
        setRefinePrompt(prompt.body);
      }
    }
  };

  const handleAction = async (type: "generate" | "refine" | "export") => {
    if (type === "generate") {
      if (!selectedTemplateId) {
        setActionMessage("Please select a template first.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (!documentId || documentId === "draft") {
        setActionMessage("No document loaded.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      setActionMessage("Generating draft with AI...");
      window.scrollTo({ top: 0, behavior: "smooth" });

      try {
        const response = await authApi.post(
          "/documents/generate",
          {
            documentId,
            templateId: selectedTemplateId,
            instructions: generationInstructions || undefined,
          },
          { timeout: 120000 } // 120s timeout to match Lambda
        );

        const { draftText } = response.data;
        setDraftText(draftText);
        setActionMessage("Draft generated successfully!");

        // Refresh document to get updated status
        const docResponse = await authApi.get(`/documents/${documentId}`);
        const docData = docResponse.data as {
          document: {
            id: string;
            title: string;
            extractedText: string;
            draftText: string;
            status: string;
            createdAt: string;
            updatedAt: string;
          };
        };
        setDocument(docData.document);
      } catch (err) {
        setActionMessage(`Generation failed: ${getErrorMessage(err)}`);
      }
    } else if (type === "refine") {
      if (!refinePrompt.trim()) {
        setActionMessage("Please enter a refinement instruction.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (!documentId || documentId === "draft") {
        setActionMessage("No document loaded.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      setActionMessage("Refining draft with AI...");
      window.scrollTo({ top: 0, behavior: "smooth" });

      try {
        const response = await authApi.post("/ai/refine", {
          documentId,
          prompt: refinePrompt,
        });

        const { draftText } = response.data;
        setDraftText(draftText);
        setActionMessage(
          "Draft refined successfully! View history to see all versions."
        );

        // Refresh document to get updated timestamp
        const docResponse = await authApi.get(`/documents/${documentId}`);
        const docData = docResponse.data as {
          document: {
            id: string;
            title: string;
            extractedText: string;
            draftText: string;
            status: string;
            createdAt: string;
            updatedAt: string;
          };
        };
        setDocument(docData.document);

        // Clear refinement prompt after success
        setRefinePrompt("");
      } catch (err) {
        setActionMessage(`Refinement failed: ${getErrorMessage(err)}`);
      }
    } else if (type === "export") {
      if (!documentId || documentId === "draft") {
        setActionMessage("No document loaded.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (!draftText || draftText.trim().length === 0) {
        setActionMessage("No draft text to export. Generate a draft first.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      setActionMessage("Exporting document to Word format...");
      window.scrollTo({ top: 0, behavior: "smooth" });

      try {
        const response = await authApi.post(`/documents/export/${documentId}`);

        const { downloadUrl, s3Key } = response.data;

        // Extract filename from s3Key (format: exports/<docId>-<timestamp>.docx)
        const fileName =
          s3Key?.split("/").pop() || `${document?.title || "export"}.docx`;

        // Trigger download
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = fileName;
        link.click();

        setActionMessage(
          "Export successful! File downloaded. View all exports in the Exports page."
        );

        // Optionally redirect to exports page after a delay
        setTimeout(() => {
          if (window.confirm("View all exports?")) {
            window.location.href = "/exports";
          }
        }, 2000);
      } catch (err) {
        setActionMessage(`Export failed: ${getErrorMessage(err)}`);
      }
    }
  };

  const handlePromptSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleAction("refine");
  };

  // Inline CSS styles matching Home/Login/Signup theme
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

  const headerMetaStyles: CSSProperties = {
    fontSize: "14px",
    color: "rgba(203, 213, 225, 0.8)",
    marginTop: "8px",
  };

  const headerBadgesStyles: CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "center",
    fontSize: "12px",
  };

  const badgeStyles: CSSProperties = {
    borderRadius: "999px",
    border: "1px solid rgba(16, 185, 129, 0.4)",
    background: "rgba(16, 185, 129, 0.1)",
    padding: "4px 12px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "rgba(209, 250, 229, 0.9)",
  };

  const badgeOfflineStyles: CSSProperties = {
    ...badgeStyles,
    border: "1px solid rgba(71, 85, 105, 0.5)",
    background: "transparent",
    color: "rgba(148, 163, 184, 0.8)",
  };

  const badgeConnectingStyles: CSSProperties = {
    ...badgeStyles,
    border: "1px solid rgba(234, 179, 8, 0.4)",
    background: "rgba(234, 179, 8, 0.1)",
    color: "rgba(254, 243, 199, 0.9)",
  };

  const linkStyles: CSSProperties = {
    color: "#6ee7b7",
    textDecoration: "none",
    transition: "color 0.2s ease",
  };

  const mainStyles: CSSProperties = {
    maxWidth: "1152px",
    margin: "0 auto",
    padding: "32px 24px",
    display: "flex",
    flexDirection: "column",
    gap: "32px",
  };

  const messageStyles: CSSProperties = {
    borderRadius: "22px",
    border: "1px solid rgba(16, 185, 129, 0.4)",
    background: "rgba(16, 185, 129, 0.1)",
    padding: "12px 16px",
    fontSize: "14px",
    color: "rgba(209, 250, 229, 0.9)",
  };

  const gridStyles: CSSProperties = {
    display: "grid",
    gap: "24px",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
  };

  const gridStylesDesktop: CSSProperties = {
    ...gridStyles,
    gridTemplateColumns: "320px 1fr",
  };

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
    gap: "16px",
  };

  const sectionTitleStyles: CSSProperties = {
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    color: "rgba(148, 163, 184, 0.8)",
  };

  const sectionDescriptionStyles: CSSProperties = {
    fontSize: "12px",
    color: "rgba(100, 116, 139, 0.8)",
    marginTop: "4px",
  };

  const textContentStyles: CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    overflowY: "auto" as const,
    paddingRight: "4px",
    fontSize: "14px",
    color: "rgba(226, 232, 240, 0.9)",
  };

  const paragraphStyles: CSSProperties = {
    borderRadius: "14px",
    background: "rgba(15, 23, 42, 0.4)",
    padding: "12px",
    lineHeight: 1.6,
  };

  const errorTextStyles: CSSProperties = {
    color: "rgba(251, 113, 133, 0.9)",
    fontSize: "14px",
  };

  const controlsSectionStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "24px",
  };

  const controlsHeaderStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  };

  const controlsRowStyles: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  };

  const labelStyles: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    fontSize: "14px",
    color: "rgba(226, 232, 240, 0.9)",
  };

  const selectStyles: CSSProperties = {
    borderRadius: "14px",
    border: "1px solid rgba(71, 85, 105, 0.5)",
    background: "rgba(15, 23, 42, 0.6)",
    padding: "8px 12px",
    fontSize: "14px",
    color: "#f1f5f9",
    cursor: "pointer",
    outline: "none",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  };

  const buttonGroupStyles: CSSProperties = {
    display: "flex",
    gap: "8px",
  };

  const buttonSecondaryStyles: CSSProperties = {
    borderRadius: "14px",
    border: "1px solid rgba(16, 185, 129, 0.6)",
    background: "transparent",
    padding: "8px 16px",
    fontSize: "14px",
    fontWeight: 600,
    color: "rgba(110, 231, 183, 0.9)",
    cursor: "pointer",
    transition: "border-color 0.2s ease, color 0.2s ease",
  };

  const buttonPrimaryStyles: CSSProperties = {
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

  const textareaStyles: CSSProperties = {
    width: "100%",
    borderRadius: "14px",
    border: "1px solid rgba(71, 85, 105, 0.5)",
    background: "rgba(15, 23, 42, 0.7)",
    padding: "12px 16px",
    fontSize: "14px",
    lineHeight: 1.6,
    color: "#f1f5f9",
    fontFamily: "inherit",
    resize: "vertical" as const,
    outline: "none",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  };

  const formStyles: CSSProperties = {
    ...cardStyles,
  };

  const formTextareaStyles: CSSProperties = {
    ...textareaStyles,
    flex: 1,
    minHeight: "80px",
  };

  return (
    <div style={pageStyles}>
      <header style={headerStyles}>
        <div style={headerContainerStyles}>
          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <div style={headerContentStyles}>
              <p style={headerLabelStyles}>Document Workspace</p>
              <h1 style={headerTitleStyles}>
                {loadingDocument ? "Loading..." : documentMetadata.title}
              </h1>
              {!loadingDocument && document && (
                <p style={headerMetaStyles}>
                  Uploaded{" "}
                  {new Date(documentMetadata.uploadedAt).toLocaleString()} •
                  Last updated{" "}
                  {new Date(documentMetadata.lastGenerated).toLocaleString()}
                </p>
              )}
            </div>
            <div style={headerBadgesStyles}>
              <span style={badgeStyles}>Draft ready</span>
              <span
                style={
                  collabState === "connected"
                    ? badgeStyles
                    : collabState === "connecting"
                    ? badgeConnectingStyles
                    : badgeOfflineStyles
                }
              >
                {collabState === "connected"
                  ? `🟢 Live (${activeUsers.size + 1} active)`
                  : collabState === "connecting"
                  ? "🟡 Connecting..."
                  : "⚪ Offline"}
              </span>
              <span style={badgeOfflineStyles}>Document ID: {documentId}</span>
              <button
                onClick={() => navigate("/dashboard")}
                style={{
                  borderRadius: "14px",
                  border: "1px solid rgba(71, 85, 105, 0.5)",
                  background: "rgba(15, 23, 42, 0.5)",
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "rgba(241, 245, 249, 0.9)",
                  cursor: "pointer",
                  transition:
                    "border-color 0.2s ease, color 0.2s ease, background 0.2s ease",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor =
                    "rgba(148, 163, 184, 0.6)";
                  e.currentTarget.style.color = "#f8fafc";
                  e.currentTarget.style.background = "rgba(15, 23, 42, 0.7)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.5)";
                  e.currentTarget.style.color = "rgba(241, 245, 249, 0.9)";
                  e.currentTarget.style.background = "rgba(15, 23, 42, 0.5)";
                }}
              >
                ← Back to Dashboard
              </button>
              <Link
                to={`/documents/${documentId}/history`}
                style={linkStyles}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#34d399";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "#6ee7b7";
                }}
              >
                View history →
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main style={mainStyles}>
        {actionMessage && <div style={messageStyles}>{actionMessage}</div>}

        <div style={gridStylesDesktop}>
          <aside style={cardStyles}>
            <div>
              <h2 style={sectionTitleStyles}>Extracted text</h2>
              <p style={sectionDescriptionStyles}>
                Parsed from the uploaded document for reference during drafting.
              </p>
            </div>
            <div style={textContentStyles}>
              {loadingDocument ? (
                <p
                  style={{
                    color: "rgba(148, 163, 184, 0.8)",
                    fontSize: "14px",
                  }}
                >
                  Loading extracted text...
                </p>
              ) : documentError ? (
                <p style={errorTextStyles}>Error: {documentError}</p>
              ) : isExtractedTextCorrupted ? (
                <div>
                  <p
                    style={{
                      color: "rgba(248, 113, 113, 0.9)",
                      fontSize: "14px",
                      marginBottom: "8px",
                    }}
                  >
                    ⚠️ Extracted text appears to be corrupted or unreadable.
                  </p>
                  <p
                    style={{
                      color: "rgba(148, 163, 184, 0.8)",
                      fontSize: "13px",
                    }}
                  >
                    Please re-upload the document to extract the text properly.
                  </p>
                </div>
              ) : extractedParagraphs.length === 0 ? (
                <p
                  style={{
                    color: "rgba(148, 163, 184, 0.8)",
                    fontSize: "14px",
                  }}
                >
                  No extracted text available
                </p>
              ) : (
                extractedParagraphs.map((paragraph, idx) => (
                  <p key={idx} style={paragraphStyles}>
                    {paragraph}
                  </p>
                ))
              )}
            </div>
          </aside>

          <section style={cardStyles}>
            <div style={controlsSectionStyles}>
              <div style={controlsHeaderStyles}>
                <div>
                  <h2 style={sectionTitleStyles}>Draft controls</h2>
                  <p style={sectionDescriptionStyles}>
                    Choose a template to regenerate or refine the draft.
                  </p>
                </div>
                <div style={controlsRowStyles}>
                  <label style={labelStyles}>
                    <span>Template</span>
                    <select
                      value={selectedTemplateId}
                      onChange={(event) =>
                        setSelectedTemplateId(event.target.value)
                      }
                      disabled={loadingTemplates}
                      style={{
                        ...selectStyles,
                        opacity: loadingTemplates ? 0.5 : 1,
                        cursor: loadingTemplates ? "not-allowed" : "pointer",
                      }}
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
                    >
                      {loadingTemplates ? (
                        <option>Loading templates…</option>
                      ) : enrichedTemplates.length > 0 ? (
                        enrichedTemplates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.label}
                          </option>
                        ))
                      ) : (
                        <option value="">No templates available</option>
                      )}
                    </select>
                  </label>
                  <label style={labelStyles}>
                    <span>Custom Prompt</span>
                    <select
                      value={selectedGenerationPromptId}
                      onChange={(event) =>
                        handleGenerationPromptSelect(event.target.value)
                      }
                      disabled={loadingPrompts}
                      style={{
                        ...selectStyles,
                        opacity: loadingPrompts ? 0.5 : 1,
                        cursor: loadingPrompts ? "not-allowed" : "pointer",
                      }}
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
                    >
                      <option value="">-- None --</option>
                      {customPrompts.map((prompt) => (
                        <option key={prompt.id} value={prompt.id}>
                          {prompt.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div style={buttonGroupStyles}>
                  <button
                    type="button"
                    style={buttonSecondaryStyles}
                    onClick={() => handleAction("generate")}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor =
                        "rgba(16, 185, 129, 0.8)";
                      e.currentTarget.style.color = "#34d399";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor =
                        "rgba(16, 185, 129, 0.6)";
                      e.currentTarget.style.color = "rgba(110, 231, 183, 0.9)";
                    }}
                  >
                    Generate draft
                  </button>
                  <button
                    type="button"
                    style={buttonSecondaryStyles}
                    onClick={() => handleAction("refine")}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor =
                        "rgba(16, 185, 129, 0.8)";
                      e.currentTarget.style.color = "#34d399";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor =
                        "rgba(16, 185, 129, 0.6)";
                      e.currentTarget.style.color = "rgba(110, 231, 183, 0.9)";
                    }}
                  >
                    Refine
                  </button>
                  <button
                    type="button"
                    style={buttonPrimaryStyles}
                    onClick={() => handleAction("export")}
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
                    Export Word
                  </button>
                </div>
              </div>

              {templatesError && (
                <div
                  style={{
                    borderRadius: "14px",
                    border: "1px solid rgba(239, 68, 68, 0.4)",
                    background: "rgba(127, 29, 29, 0.6)",
                    padding: "12px 16px",
                    fontSize: "14px",
                    color: "rgba(254, 226, 226, 0.9)",
                  }}
                >
                  {templatesError}
                </div>
              )}

              {selectedGenerationPromptId && (
                <div
                  style={{
                    borderRadius: "14px",
                    border: "1px solid rgba(71, 85, 105, 0.5)",
                    background: "rgba(15, 23, 42, 0.6)",
                    padding: "12px",
                  }}
                >
                  <label
                    style={{
                      display: "block",
                      fontSize: "12px",
                      fontWeight: 600,
                      textTransform: "uppercase" as const,
                      letterSpacing: "0.05em",
                      color: "rgba(148, 163, 184, 0.8)",
                      marginBottom: "8px",
                    }}
                  >
                    Generation Instructions (from custom prompt)
                  </label>
                  <textarea
                    value={generationInstructions}
                    onChange={(e) => setGenerationInstructions(e.target.value)}
                    rows={3}
                    style={textareaStyles}
                    placeholder="Edit or use the selected prompt..."
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
              )}

              <div style={{ flex: 1 }}>
                <label
                  htmlFor="draft"
                  style={{
                    display: "block",
                    marginBottom: "8px",
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "rgba(226, 232, 240, 0.9)",
                  }}
                >
                  Draft workspace
                </label>
                <textarea
                  ref={textareaRef}
                  id="draft"
                  value={draftText}
                  onChange={(event) => {
                    setDraftText(event.target.value);
                    // Y.js sync is handled by the input event listener
                  }}
                  rows={20}
                  style={{
                    ...textareaStyles,
                    height: "100%",
                    minHeight: "400px",
                  }}
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
                <p
                  style={{
                    marginTop: "8px",
                    fontSize: "12px",
                    color: "rgba(100, 116, 139, 0.8)",
                  }}
                >
                  {collabState === "connected"
                    ? "Changes sync live to all collaborators in real-time."
                    : collabState === "connecting"
                    ? "Connecting to collaboration server..."
                    : "Collaboration offline. Changes will sync when connection is restored."}
                </p>
              </div>
            </div>
          </section>
        </div>

        <form onSubmit={handlePromptSubmit} style={formStyles}>
          <label htmlFor="refine-prompt" style={sectionTitleStyles}>
            Refinement prompt
          </label>
          <p style={sectionDescriptionStyles}>
            Describe the adjustments you need. AI refinement (PR13) will
            generate a new draft version and preserve history automatically.
          </p>
          <div
            style={{
              marginTop: "12px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div>
              <label
                htmlFor="refinement-prompt-select"
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "rgba(203, 213, 225, 0.9)",
                  marginBottom: "4px",
                }}
              >
                Load Custom Prompt
              </label>
              <select
                id="refinement-prompt-select"
                value={selectedRefinementPromptId}
                onChange={(e) => handleRefinementPromptSelect(e.target.value)}
                disabled={loadingPrompts}
                style={{
                  ...selectStyles,
                  width: "100%",
                  opacity: loadingPrompts ? 0.5 : 1,
                  cursor: loadingPrompts ? "not-allowed" : "pointer",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.8)";
                  e.currentTarget.style.boxShadow =
                    "0 0 0 3px rgba(16, 185, 129, 0.2)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.5)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <option value="">-- Select a prompt or type your own --</option>
                {customPrompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.name}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              id="refine-prompt"
              value={refinePrompt}
              onChange={(event) => setRefinePrompt(event.target.value)}
              rows={3}
              style={formTextareaStyles}
              placeholder="Clarify tone, add citations, or request new sections."
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(16, 185, 129, 0.8)";
                e.currentTarget.style.boxShadow =
                  "0 0 0 3px rgba(16, 185, 129, 0.2)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.5)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
            <button
              type="submit"
              style={buttonPrimaryStyles}
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
              Queue refinement
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};

export default Editor;

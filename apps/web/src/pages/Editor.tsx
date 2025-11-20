import axios from "axios";
import {
  CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { authApi, useAuth } from "../lib/auth";
import { ApiGatewayWebSocketProvider, initCollabDoc } from "../lib/collab/yjs";
import * as Y from "yjs";
import {
  ActiveUsersSidebar,
  ActiveUser,
} from "../components/ActiveUsersSidebar";
import { ConnectionStatusBadge } from "../components/ConnectionStatusBadge";
import { ToastContainer, ToastVariant } from "../components/Toast";
import { SyncStatusIndicator } from "../components/SyncStatusIndicator";
import { CollaborationErrorBoundary } from "../components/CollaborationErrorBoundary";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { ShareModal } from "../components/ShareModal";

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

const COLLAB_TOAST_KEYS = {
  CONNECTED: "collab-connected",
  RECONNECTING: "collab-reconnecting",
  CONNECTION_ERROR: "collab-connection-error",
  ACCESS_DENIED: "collab-access-denied",
  AI_OPERATION: "collab-ai-operation",
  COLLABORATOR_PRESENT: "collab-presence",
  ERROR_BOUNDARY: "collab-error-boundary",
} as const;

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
  const [refinePrompt, setRefinePrompt] = useState<string>("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Responsive layout state
  const [windowWidth, setWindowWidth] = useState<number>(window.innerWidth);

  // Track if we're applying a remote update to avoid conflicts
  const isApplyingRemoteUpdateRef = useRef<boolean>(false);
  const typingTimeoutRef = useRef<number | null>(null);

  // Y.js collaboration state
  const [collabState, setCollabState] = useState<
    | "connecting"
    | "connected"
    | "disconnected"
    | "reconnecting"
    | "failed"
    | "error"
  >("disconnected");
  const [collabStatusMessage, setCollabStatusMessage] = useState<string | null>(
    null
  );
  const [reconnectAttempt, setReconnectAttempt] = useState<number>(0);
  const [reconnectDelay, setReconnectDelay] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [activeUsers, setActiveUsers] = useState<Map<string, ActiveUser>>(
    () => new Map()
  );
  const [syncStatus, setSyncStatus] = useState<"synced" | "syncing" | "conflict">(
    "syncing"
  );
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isExtractedTextExpanded, setIsExtractedTextExpanded] = useState<boolean>(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [toasts, setToasts] = useState<
    Array<{
      id: string;
      message: string;
      variant?: ToastVariant;
      duration?: number | null;
    }>
  >([]);
  const yjsRef = useRef<{
    ydoc: Y.Doc;
    provider: ApiGatewayWebSocketProvider;
    ytext: Y.Text;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSavedRef = useRef<string>("");
  const toastRegistryRef = useRef<Map<string, string>>(new Map());

  const showToast = useCallback(
    (
      message: string,
      options: {
        variant?: ToastVariant;
        duration?: number | null;
        key?: string;
      } = {}
    ) => {
      const { variant = "success", duration = 3000, key } = options;
      if (key) {
        const existingId = toastRegistryRef.current.get(key);
        if (existingId) {
          toastRegistryRef.current.delete(key);
          setToasts((prev) => prev.filter((toast) => toast.id !== existingId));
        }
      }
      const id = `${Date.now()}-${Math.random()}`;
      setToasts((prev) => [...prev, { id, message, variant, duration }]);
      if (key) {
        toastRegistryRef.current.set(key, id);
      }
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    for (const [key, value] of toastRegistryRef.current.entries()) {
      if (value === id) {
        toastRegistryRef.current.delete(key);
        break;
      }
    }
  }, []);

  const dismissToastByKey = useCallback((key: string) => {
    const id = toastRegistryRef.current.get(key);
    if (id) {
      toastRegistryRef.current.delete(key);
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }
  }, []);

  const toggleSidebarVisibility = useCallback(() => {
    setIsSidebarVisible((prev) => !prev);
  }, []);

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
          // Find the "Default" template and select it, otherwise select the first template
          const defaultTemplate = fetched.find(
            (t) => t.title.toLowerCase() === "default"
          );
          setSelectedTemplateId(defaultTemplate?.id || fetched[0].id);
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

  // Track window width for responsive layout
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
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

  useEffect(() => {
    if (document?.updatedAt) {
      setLastSyncTime(new Date(document.updatedAt));
    }
  }, [document?.updatedAt]);

  // Store fetchPresence function in a ref so it can be called from WebSocket handlers
  const fetchPresenceRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!documentId || documentId === "draft") {
      setActiveUsers(new Map());
      fetchPresenceRef.current = null;
      return;
    }

    let cancelled = false;

    const fetchPresence = async () => {
      try {
        const response = await authApi.get(
          `/documents/${documentId}/presence`,
          {
            // Suppress error logging for 404s (expected if endpoint not deployed)
            validateStatus: (status) => status < 500, // Don't throw for 4xx errors
          }
        );

        // Only process if we got a successful response
        if (response.status === 200 && !cancelled) {
          const data = response.data as {
            activeUsers?: Array<{
              userId: string;
              userName?: string;
              email?: string;
              joinedAt?: number;
            }>;
          };

          const next = new Map<string, ActiveUser>();
          (data.activeUsers ?? []).forEach((userInfo) => {
            // Filter out current user - only show other collaborators
            if (userInfo.userId === user?.id) {
              return;
            }
            next.set(userInfo.userId, {
              userId: userInfo.userId,
              userName:
                userInfo.userName ??
                userInfo.email?.split("@")[0] ??
                "Collaborator",
              status: "online",
              joinedAt: userInfo.joinedAt ?? Date.now(),
            });
          });
          setActiveUsers(next);
        }
        // Silently ignore 404s and other 4xx errors - presence is optional
      } catch (error) {
        // Only log non-404 errors in dev mode
        if (import.meta.env.DEV) {
          const is404 =
            axios.isAxiosError(error) && error.response?.status === 404;
          if (!is404) {
            console.debug(
              "Failed to fetch initial presence (this is optional):",
              error
            );
          }
        }
        // Silently fail - WebSocket will provide real-time updates
      }
    };

    // Store in ref for use by WebSocket handlers
    fetchPresenceRef.current = fetchPresence;

    void fetchPresence();

    return () => {
      cancelled = true;
      fetchPresenceRef.current = null;
    };
  }, [documentId, user?.id]);

  // Initialize Y.js collaboration when document loads
  useEffect(() => {
    if (!documentId || documentId === "draft" || !user) {
      return;
    }

    const wsBaseUrl =
      import.meta.env.VITE_WS_BASE_URL ||
      "wss://n3fxav2xid.execute-api.us-east-1.amazonaws.com/prod";

    if (!wsBaseUrl || wsBaseUrl.includes("placeholder")) {
      console.warn("WebSocket collaboration disabled: invalid WS URL");
      return;
    }

    let cancelled = false;
    let teardown: (() => void) | null = null;

    const initYjs = async () => {
      try {
        setCollabState("connecting");
        setCollabStatusMessage(null);
        setSyncStatus("syncing");

        let jwt = "";
        try {
          const tokenResponse = await authApi.get("/auth/ws-token");
          jwt = (tokenResponse.data as { token: string }).token;
        } catch (error) {
          console.debug("WebSocket collaboration unavailable:", error);
          setCollabState("error");
          setCollabStatusMessage("Unable to fetch collaboration token.");
          return;
        }

        if (cancelled) {
          return;
        }

        const { ydoc, provider, ytext } = initCollabDoc(
          documentId,
          jwt,
          wsBaseUrl
        );

        yjsRef.current = { ydoc, provider, ytext };

        const handleStatus = (event: any) => {
          // Refetch presence when connection is established to see other active users
          // This handles the case where a user reloads and needs to see who's already connected
          const payload = Array.isArray(event) ? event[0] : event;
          if (payload?.status === "connected" && fetchPresenceRef.current) {
            // Delay to ensure connection is fully established in DynamoDB
        setTimeout(() => {
              void fetchPresenceRef.current?.();
            }, 1000);
          }
          if (!payload || typeof payload !== "object") {
            console.warn(
              "[Editor] Status event received with invalid payload:",
              event
            );
            return;
          }

          if (import.meta.env.DEV) {
            console.log("[Editor] Status event received:", payload);
          }

          const messageMap: Record<string, string> = {
            "missing-token": "Missing authentication token for collaboration.",
            "abnormal-closure":
              "Connection closed unexpectedly. Please refresh.",
            "max-retries-exceeded":
              "Unable to reconnect. Please refresh to continue collaborating.",
          };

          const friendlyMessage = payload.message
            ? messageMap[payload.message] ?? String(payload.message)
            : payload.delay
            ? `Reconnecting in ${(payload.delay / 1000).toFixed(1)}s`
            : null;

          setCollabStatusMessage(friendlyMessage);

          switch (payload.status) {
            case "connected": {
            setCollabState("connected");
              setReconnectAttempt(0);
              setReconnectDelay(null);
              setSyncStatus("synced");
              dismissToastByKey(COLLAB_TOAST_KEYS.RECONNECTING);
              dismissToastByKey(COLLAB_TOAST_KEYS.CONNECTION_ERROR);
              showToast("Connected to real-time collaboration", {
                variant: "success",
                duration: 3000,
                key: COLLAB_TOAST_KEYS.CONNECTED,
              });
              if (yjsRef.current?.provider) {
                const currentLatency = yjsRef.current.provider.getLatency();
                if (currentLatency !== null) {
                  setLatency(currentLatency);
                }
              }
              break;
            }
            case "reconnecting": {
              setCollabState("reconnecting");
              setSyncStatus("syncing");
              const attemptValue =
                typeof payload.attempt === "number" ? payload.attempt : 1;
              setReconnectAttempt(attemptValue);
              setReconnectDelay(payload.delay ?? null);
              const maxAttempts = payload.maxAttempts ?? 5;
              showToast(
                `Connection lost. Reconnecting... (Attempt ${attemptValue}/${maxAttempts})`,
                {
                  variant: "warning",
                  duration: null,
                  key: COLLAB_TOAST_KEYS.RECONNECTING,
                }
              );
              break;
            }
            case "failed": {
              setCollabState("failed");
              setSyncStatus("syncing");
              setReconnectAttempt(0);
              setReconnectDelay(null);
              dismissToastByKey(COLLAB_TOAST_KEYS.RECONNECTING);
              showToast(
                "Unable to connect. Click to retry or refresh the page.",
                {
                  variant: "error",
                  duration: null,
                  key: COLLAB_TOAST_KEYS.CONNECTION_ERROR,
                }
              );
              break;
            }
            case "error": {
            setCollabState("error");
              setSyncStatus("syncing");
              setReconnectAttempt(0);
              setReconnectDelay(null);
              showToast(
                "Collaboration offline. Changes will sync when connection is restored.",
                { variant: "error", duration: 5000 }
              );
              break;
            }
            case "connecting": {
              setCollabState("connecting");
              setSyncStatus("syncing");
              setReconnectDelay(null);
              break;
            }
            case "disconnected": {
              setCollabState("disconnected");
              setSyncStatus("syncing");
              setReconnectAttempt(0);
              setReconnectDelay(null);
              break;
            }
            default:
              break;
          }
        };

        const handlePresence = (event: any) => {
          const message = Array.isArray(event) ? event[0] : event;
          
          if (import.meta.env.DEV) {
            console.log("[Editor] Presence event received:", message);
          }
          
          if (!message?.userId || message.userId === user?.id) {
            if (import.meta.env.DEV) {
              console.log("[Editor] Filtering out current user or invalid message");
            }
            return;
          }

          const userName =
            message.userName ||
            message.email?.split?.("@")?.[0] ||
            "Collaborator";

          if (message.action === "join") {
            if (import.meta.env.DEV) {
              console.log(`[Editor] User ${userName} (${message.userId}) joined`);
            }
            setActiveUsers((prev) => {
              const next = new Map(prev);
              next.set(message.userId, {
                userId: message.userId,
                userName,
                status: "online",
                joinedAt: message.timestamp || Date.now(),
              });
              return next;
            });
            showToast(`${userName} joined the document`, {
              variant: "success",
              duration: 2500,
            });
            showToast(
              "Another user is editing. Changes will sync automatically.",
              {
                variant: "info",
                duration: 4000,
                key: COLLAB_TOAST_KEYS.COLLABORATOR_PRESENT,
              }
            );
          } else if (message.action === "existing_users") {
            // Handle list of existing users when we first join
            if (Array.isArray(message.users)) {
              if (import.meta.env.DEV) {
                console.log(
                  `[Editor] Received ${message.users.length} existing user(s)`
                );
              }
              setActiveUsers((prev) => {
                const next = new Map(prev);
                message.users.forEach((userInfo: any) => {
                  if (userInfo.userId && userInfo.userId !== user?.id) {
                    const userName =
                      userInfo.userName ||
                      userInfo.email?.split?.("@")?.[0] ||
                      "Collaborator";
                    next.set(userInfo.userId, {
                      userId: userInfo.userId,
                      userName,
                      status: "online",
                      joinedAt: Date.now(),
                    });
                  }
                });
                if (next.size > 0) {
                  showToast(
                    "Another user is editing. Changes will sync automatically.",
                    {
                      variant: "info",
                      duration: 4000,
                      key: COLLAB_TOAST_KEYS.COLLABORATOR_PRESENT,
                    }
                  );
                }
                return next;
              });
            }
          } else if (message.action === "leave") {
            setActiveUsers((prev) => {
              const next = new Map(prev);
              next.delete(message.userId);
              if (next.size === 0) {
                dismissToastByKey(COLLAB_TOAST_KEYS.COLLABORATOR_PRESENT);
              }
              return next;
            });
            showToast(`${userName} left the document`, {
              variant: "warning",
              duration: 2500,
            });
          } else if (message.cursor || message.selection) {
            // User is actively editing (typing indicator)
            setActiveUsers((prev) => {
              const next = new Map(prev);
              const existing = next.get(message.userId);
              if (existing) {
                next.set(message.userId, {
                  ...existing,
                  status: "typing",
                });
                // Reset to online after 3 seconds of no activity
                setTimeout(() => {
                  setActiveUsers((current) => {
                    const updated = new Map(current);
                    const user = updated.get(message.userId);
                    if (user && user.status === "typing") {
                      updated.set(message.userId, {
                        ...user,
                        status: "online",
                      });
                    }
                    return updated;
                  });
                }, 3000);
              } else {
                // User not in map yet, add them
                next.set(message.userId, {
                  userId: message.userId,
                  userName,
                  status: "typing",
                  joinedAt: Date.now(),
                });
              }
              return next;
            });
          }
        };

        const handleProviderError = (event: any) => {
          const payload = Array.isArray(event) ? event[0] : event;
          if (!payload) {
            return;
          }
          const type = String(payload.type ?? payload.code ?? "error").toLowerCase();
          const messageText =
            payload.message ??
            payload.error ??
            "Collaboration error occurred.";

          if (type.includes("access")) {
            showToast("You no longer have access to this document", {
              variant: "error",
              duration: null,
              key: COLLAB_TOAST_KEYS.ACCESS_DENIED,
            });
          } else if (type.includes("connection_limit")) {
            showToast(
              "Maximum connections reached. Close other tabs or devices to continue.",
              {
                variant: "error",
                duration: null,
                key: COLLAB_TOAST_KEYS.CONNECTION_ERROR,
              }
            );
          } else if (type === "manual_sync_failed") {
            showToast(messageText, { variant: "error", duration: 5000 });
          } else {
            showToast(messageText, { variant: "error", duration: 5000 });
          }

          setCollabState("error");
          setCollabStatusMessage(messageText);
        };

        const handleSyncStatusEvent = (event: any) => {
          const payload = Array.isArray(event) ? event[0] : event;
          if (!payload?.status) {
            return;
          }
          setSyncStatus(payload.status);
          if (payload.status === "synced") {
            setLastSyncTime(new Date());
            // Refetch presence after successful join to see other active users
            // This ensures we see users who were already connected when we joined
            if (fetchPresenceRef.current) {
              // Small delay to ensure the connection is fully established in DynamoDB
              setTimeout(() => {
                void fetchPresenceRef.current?.();
              }, 500);
            }
          }
        };

        const handleLatency = (event: any) => {
          // lib0 Observable may pass the event directly or as an array
          const payload = Array.isArray(event) ? event[0] : event;
          if (payload?.latency !== undefined && payload.latency !== null) {
            setLatency(payload.latency);
          }
        };

        const handleYjsChange = () => {
          // Use functional update to ensure we get the latest Y.js state
          const newText = ytext.toString();
          const prevText = draftText;
          
          if (import.meta.env.DEV) {
            console.log(
              `[Editor] Y.js text changed: ${prevText.length} -> ${newText.length} chars`,
              { 
                changed: prevText !== newText,
                prefixMatch: prevText.substring(0, 50) === newText.substring(0, 50)
              }
            );
          }
          
          // Mark that we're applying a remote update to prevent local edits from conflicting
          isApplyingRemoteUpdateRef.current = true;
          // Force update - don't check if it changed, just update
          // This ensures we always reflect the latest Y.js state
          setDraftText(newText);
          // Reset the flag after a short delay to allow React to update
          setTimeout(() => {
            isApplyingRemoteUpdateRef.current = false;
          }, 0);
        };

        provider.on("status", handleStatus);
        provider.on("presence", handlePresence);
        provider.on("error", handleProviderError);
        provider.on("latency", handleLatency);
        provider.on("sync-status", handleSyncStatusEvent);
        
        // Listen for refinement events
        provider.on("refinement_started", () => {
          showToast("AI is refining draft. Editing will be re-enabled shortly.", {
            variant: "info",
            duration: null,
            key: COLLAB_TOAST_KEYS.AI_OPERATION,
          });
        });
        
        provider.on("refinement_complete", (event: any) => {
          const payload = Array.isArray(event) ? event[0] : event;
          if (payload?.text !== undefined) {
            console.log(`[Editor] Refinement complete event received: ${payload.beforeLength} -> ${payload.afterLength} chars`);
            // Y.js has already been updated, just sync the state
            isApplyingRemoteUpdateRef.current = true;
            setDraftText(payload.text);
            setTimeout(() => {
              isApplyingRemoteUpdateRef.current = false;
            }, 0);
          }
          // Dismiss the AI operation toast
          dismissToast(COLLAB_TOAST_KEYS.AI_OPERATION);
        });
        
        // Listen for explicit remote update events
        provider.on("remote-update", (event: any) => {
          const payload = Array.isArray(event) ? event[0] : event;
          if (payload?.text !== undefined) {
            console.log(`[Editor] Remote update event received: ${payload.beforeLength} -> ${payload.afterLength} chars`);
            isApplyingRemoteUpdateRef.current = true;
            setDraftText(payload.text);
            setTimeout(() => {
              isApplyingRemoteUpdateRef.current = false;
            }, 0);
          }
        });
        
        // Observe Y.Text changes - this fires for both local and remote updates
        // When a remote update is applied via Y.applyUpdate, ytext.observe should fire
        ytext.observe(handleYjsChange);
        
        // Also observe document updates as a fallback to catch remote updates
        // This ensures we catch updates even if ytext.observe doesn't fire for some reason
        const handleDocUpdate = (update: Uint8Array, origin: any) => {
          // Only handle remote updates (from provider), local updates are handled by ytext.observe
          if (origin === provider) {
            // Use requestAnimationFrame to ensure Y.js has applied the update
            requestAnimationFrame(() => {
              const currentText = ytext.toString();
              // Force update - don't check if it changed, just update
              // This ensures we always reflect the latest Y.js state
              isApplyingRemoteUpdateRef.current = true;
              setDraftText(currentText);
              setTimeout(() => {
                isApplyingRemoteUpdateRef.current = false;
              }, 0);
            });
          }
        };
        ydoc.on("update", handleDocUpdate);

        // Initialize Y.js text with current draft text (only if empty)
        if (document?.draftText && ytext.length === 0) {
          ytext.insert(0, document.draftText);
          setDraftText(document.draftText);
        } else {
          setDraftText(ytext.toString());
        }

        // Connect after listeners are registered
        provider.connect();

        // Fallback: Periodic check of WebSocket state to ensure UI stays in sync
        // This handles cases where Observable events might not fire
        const statusCheckInterval = setInterval(() => {
          if (yjsRef.current?.provider) {
            const actualStatus = yjsRef.current.provider.getStatus();
            // Use functional update to get current state
            setCollabState((currentState) => {
              if (
                actualStatus === "connected" &&
                currentState !== "connected"
              ) {
                if (import.meta.env.DEV) {
                  console.log(
                    "[Editor] Fallback: Detected connected state, updating UI"
                  );
                }
                setReconnectAttempt(0);
                setReconnectDelay(null);
                // Get latency if available
                if (yjsRef.current?.provider) {
                  const currentLatency = yjsRef.current.provider.getLatency();
                  if (currentLatency !== null) {
                    setLatency(currentLatency);
                  }
                }
                return "connected";
              } else if (
                actualStatus === "disconnected" &&
                currentState === "connected"
              ) {
                if (import.meta.env.DEV) {
                  console.log(
                    "[Editor] Fallback: Detected disconnected state, updating UI"
                  );
                }
                setReconnectDelay(null);
                return "disconnected";
              }
              return currentState;
            });
          }
        }, 500); // Check every 500ms

        teardown = () => {
          clearInterval(statusCheckInterval);
          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = null;
          }
          provider.off("status", handleStatus);
          provider.off("presence", handlePresence);
          provider.off("error", handleProviderError);
          provider.off("latency", handleLatency);
          provider.off("sync-status", handleSyncStatusEvent);
          ytext.unobserve(handleYjsChange);
          ydoc.off("update", handleDocUpdate);
        };
      } catch (error) {
        console.error("Failed to initialize Y.js collaboration:", error);
        setCollabState("error");
        setCollabStatusMessage("Failed to initialize collaboration.");
      }
    };

    void initYjs();

    return () => {
      cancelled = true;
      if (yjsRef.current) {
        yjsRef.current.provider.disconnect();
        yjsRef.current.ydoc.destroy();
        yjsRef.current = null;
      }
      setActiveUsers(new Map());
      setCollabState("disconnected");
      setCollabStatusMessage(null);
      if (teardown) {
        teardown();
      }
    };
  }, [documentId, user, showToast, dismissToastByKey]);

  const applyDiffToYText = (newValue: string) => {
    if (!yjsRef.current) {
      return;
    }

    const { ytext, ydoc, provider } = yjsRef.current;
    const currentValue = ytext.toString();

    if (currentValue === newValue) {
      return;
    }

    // Only check if WebSocket is open - don't require isSynced here
    // The ydoc.on("update") handler will check isSynced before sending
    if (provider.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const oldLen = currentValue.length;
    const newLen = newValue.length;

      let prefixLen = 0;
      while (
        prefixLen < oldLen &&
        prefixLen < newLen &&
      currentValue[prefixLen] === newValue[prefixLen]
      ) {
        prefixLen++;
      }

      let suffixLen = 0;
      while (
        suffixLen < oldLen - prefixLen &&
        suffixLen < newLen - prefixLen &&
      currentValue[oldLen - 1 - suffixLen] === newValue[newLen - 1 - suffixLen]
      ) {
        suffixLen++;
      }

      const deleteStart = prefixLen;
      const deleteLen = oldLen - prefixLen - suffixLen;
    const insertText = newValue.substring(prefixLen, newLen - suffixLen);

    // Use transact with null origin to ensure the update is sent to server
    // null origin means this is a local edit, not from the provider
    ydoc.transact(() => {
        if (deleteLen > 0) {
          ytext.delete(deleteStart, deleteLen);
        }
        if (insertText.length > 0) {
          ytext.insert(deleteStart, insertText);
        }
    }, null); // null origin = local edit, should be sent to server
  };

  const handleManualRetry = useCallback(() => {
    const provider = yjsRef.current?.provider;
    if (!provider) {
      showToast("Collaboration is not initialized yet.", {
        variant: "warning",
        duration: 3000,
      });
      return;
    }

    provider.forceReconnect();
    showToast("Retrying connection…", { variant: "info", duration: 2000 });
  }, [showToast]);

  const handleManualSync = useCallback(() => {
    const provider = yjsRef.current?.provider;
    if (!provider) {
      showToast("Collaboration is not initialized yet.", {
        variant: "warning",
        duration: 3000,
      });
      return;
    }

    const result = provider.manualSync();
    if (result) {
      showToast("Manual sync triggered", { variant: "info", duration: 2000 });
    }
  }, [showToast]);

  // Auto-save draft text periodically
  useEffect(() => {
    if (!documentId || documentId === "draft") {
      return;
    }

    const saveInterval = setInterval(async () => {
      // Always use Y.js text if available (it's the source of truth during collaboration)
      // Fall back to draftText state if Y.js isn't initialized
      const yTextValue =
        yjsRef.current?.ytext
          ? yjsRef.current.ytext.toString()
          : draftText;

      // Skip if empty or unchanged
      if (
        !yTextValue ||
        yTextValue.trim() === "" ||
        yTextValue === lastSavedRef.current
      ) {
        return;
      }

      // Only save if we have a valid document ID and the text has actually changed
      if (!documentId || documentId === "draft") {
        return;
      }

      try {
        await authApi.put(`/documents/${documentId}/draft`, {
          draftText: yTextValue,
        });
        lastSavedRef.current = yTextValue;
        if (import.meta.env.DEV) {
          console.log(`[Editor] Auto-saved draft (${yTextValue.length} chars)`);
        }
      } catch (err: any) {
        // Only log errors that aren't access-related (those are expected for viewers)
        if (err?.response?.status !== 403) {
          console.error("Auto-save failed:", err);
        }
      }
    }, 2000);

    return () => clearInterval(saveInterval);
  }, [documentId, draftText]);

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
    // Remove excessive line breaks (3+ newlines become 2) but preserve original formatting
    return document.extractedText
      .replace(/\n{3,}/g, '\n\n') // Replace 3+ consecutive newlines with 2
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }, [document?.extractedText]);

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
      showToast(
        "AI is generating draft. Editing will be re-enabled shortly.",
        {
          variant: "info",
          duration: null,
          key: COLLAB_TOAST_KEYS.AI_OPERATION,
        }
      );

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
        
        // Update Y.js with the new draft text so other users see the changes
        // Update even if not fully synced - generation updates are authoritative
        if (yjsRef.current && yjsRef.current.provider.ws?.readyState === WebSocket.OPEN) {
          const { ytext, ydoc } = yjsRef.current;
          // Replace entire Y.Text content with the new draft
          ydoc.transact(() => {
            const currentLength = ytext.length;
            if (currentLength > 0) {
              ytext.delete(0, currentLength);
            }
            if (draftText.length > 0) {
              ytext.insert(0, draftText);
            }
          }, null);
          if (import.meta.env.DEV) {
            console.log("[Editor] Updated Y.js with generated draft text (isSynced: " + yjsRef.current.provider.isSynced + ")");
          }
        }
        
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
      } finally {
        dismissToastByKey(COLLAB_TOAST_KEYS.AI_OPERATION);
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
      showToast(
        "AI is refining draft. Editing will be re-enabled shortly.",
        {
          variant: "info",
          duration: null,
          key: COLLAB_TOAST_KEYS.AI_OPERATION,
        }
      );

      try {
        const response = await authApi.post("/ai/refine", {
          documentId,
          prompt: refinePrompt,
        });

        const { draftText } = response.data;
        setDraftText(draftText);
        
        // Update Y.js with the refined draft text so other users see the changes
        // Update even if not fully synced - refinement updates are authoritative
        // Note: The refinement_complete event will also be broadcast, but updating
        // locally ensures immediate UI update and sends the update to other users
        if (yjsRef.current && yjsRef.current.provider.ws?.readyState === WebSocket.OPEN) {
          const { ytext, ydoc } = yjsRef.current;
          // Replace entire Y.Text content with the refined draft
          ydoc.transact(() => {
            const currentLength = ytext.length;
            if (currentLength > 0) {
              ytext.delete(0, currentLength);
            }
            if (draftText.length > 0) {
              ytext.insert(0, draftText);
            }
          }, null);
          if (import.meta.env.DEV) {
            console.log("[Editor] Updated Y.js with refined draft text (isSynced: " + yjsRef.current.provider.isSynced + ")");
          }
        }
        
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
      } finally {
        dismissToastByKey(COLLAB_TOAST_KEYS.AI_OPERATION);
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

        const { downloadUrl, fileName } = response.data;

        // Use AI-generated filename, or fallback to document title
        const downloadFileName =
          fileName || `${document?.title || "export"}.docx`;

        // Trigger download
        const link = window.document.createElement("a");
        link.href = downloadUrl;
        link.download = downloadFileName;
        link.click();

        setActionMessage(
          "Export successful! File downloaded. View all exports in the Exports page."
        );
      } catch (err) {
        setActionMessage(`Export failed: ${getErrorMessage(err)}`);
      }
    }
  };

  const keyboardShortcuts = useMemo(() => {
    const shortcuts = [
      {
        key: "c",
        ctrl: true,
        shift: true,
        handler: toggleSidebarVisibility,
      },
      // Removed Cmd+Shift+R handler - conflicts with browser hard refresh
      // Retry functionality is available via the "Retry" button in ConnectionStatusBadge
    ];

    if (import.meta.env.DEV) {
      shortcuts.push({
        key: "s",
        ctrl: true,
        shift: true,
        handler: handleManualSync,
      });
    }

    return shortcuts;
  }, [handleManualSync, toggleSidebarVisibility]);

  useKeyboardShortcuts(keyboardShortcuts);

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

  // Responsive grid: 3 columns on large screens, 2 columns on medium, 1 column on small
  // Adjusts based on sidebar visibility - when hidden, draft controls expand to fill space
  // Compute screen size breakpoints (used in multiple places)
  const isExtraWideScreen = windowWidth >= 1600;
  const isLargeScreen = windowWidth >= 1200;
  const isMediumScreen = windowWidth >= 768 && windowWidth < 1200;

  const gridStylesDesktop: CSSProperties = useMemo(() => {

    // Determine grid template columns based on screen size and sidebar visibility
    let gridTemplateColumns: string;
    
    if (isSidebarVisible) {
      // Sidebar visible: 3 columns (refinement prompt, draft controls, active users)
      if (isExtraWideScreen) {
        gridTemplateColumns = "280px 1fr 200px"; // Extra-wide: narrower side panels
      } else if (isLargeScreen) {
        gridTemplateColumns = "320px 1fr 220px"; // Large: standard 3 columns
      } else if (isMediumScreen) {
        gridTemplateColumns = "1fr 220px"; // Medium: draft controls + active users
      } else {
        gridTemplateColumns = "1fr"; // Small: single column
      }
    } else {
      // Sidebar hidden: 2 columns (refinement prompt, draft controls) - draft controls expand
      if (isExtraWideScreen) {
        gridTemplateColumns = "280px 1fr"; // Extra-wide: refinement prompt + expanded draft controls
      } else if (isLargeScreen) {
        gridTemplateColumns = "320px 1fr"; // Large: refinement prompt + expanded draft controls
      } else if (isMediumScreen) {
        gridTemplateColumns = "1fr"; // Medium: single column (refinement prompt spans full width)
      } else {
        gridTemplateColumns = "1fr"; // Small: single column
      }
    }

    return {
      display: "grid",
      gap: "24px",
      gridTemplateColumns,
    };
  }, [isSidebarVisible, windowWidth]);

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
    minWidth: 0, // Allow flex items to shrink below their content size
    overflow: "hidden" as const, // Prevent content from spilling out
  };

  // Style for refinement prompt aside - spans full width on medium screens
  const refinementPromptStyles: CSSProperties = {
    ...cardStyles,
    gridColumn: isMediumScreen ? "1 / -1" : undefined, // Span all columns on medium screens
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
    gap: "8px",
    overflowY: "auto" as const,
    paddingRight: "4px",
    fontSize: "14px",
    color: "rgba(226, 232, 240, 0.9)",
  };

  const paragraphStyles: CSSProperties = {
    borderRadius: "8px",
    background: "rgba(15, 23, 42, 0.4)",
    padding: "8px 12px",
    lineHeight: 1.5,
    marginBottom: "4px",
    whiteSpace: "pre-wrap" as const,
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
    boxSizing: "border-box" as const,
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
    overflowWrap: "break-word" as const,
    wordWrap: "break-word" as const,
    whiteSpace: "pre-wrap" as const,
    overflowX: "hidden" as const,
    overflowY: "auto" as const,
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
    <CollaborationErrorBoundary
      onError={() =>
        showToast("Collaboration error. Please refresh this page.", {
          variant: "error",
          duration: null,
          key: COLLAB_TOAST_KEYS.ERROR_BOUNDARY,
        })
      }
    >
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
                  {new Date(documentMetadata.uploadedAt).toLocaleString(
                    undefined,
                    {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }
                  )}{" "}
                  • Last updated{" "}
                  {new Date(documentMetadata.lastGenerated).toLocaleString(
                    undefined,
                    {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }
                  )}
                </p>
              )}
            </div>
            <div style={headerBadgesStyles}>
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
              <button
                onClick={() => navigate(`/documents/${documentId}/history`)}
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
                View history
              </button>
              {documentId !== "draft" && (
                <button
                  type="button"
                  onClick={() => setIsShareModalOpen(true)}
                  style={{
                    borderRadius: "14px",
                    border: "1px solid rgba(59, 130, 246, 0.5)",
                    background: "rgba(30, 64, 175, 0.4)",
                    padding: "6px 12px",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "rgba(219, 234, 254, 0.95)",
                    cursor: "pointer",
                    transition:
                      "border-color 0.2s ease, color 0.2s ease, background 0.2s ease",
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor =
                      "rgba(96, 165, 250, 0.8)";
                    e.currentTarget.style.color = "#e0f2fe";
                    e.currentTarget.style.background = "rgba(30, 64, 175, 0.55)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor =
                      "rgba(59, 130, 246, 0.5)";
                    e.currentTarget.style.color = "rgba(219, 234, 254, 0.95)";
                    e.currentTarget.style.background = "rgba(30, 64, 175, 0.4)";
                  }}
                >
                  Share
                </button>
              )}
              <button
                type="button"
                onClick={toggleSidebarVisibility}
                aria-pressed={!isSidebarVisible}
                title="Toggle collaborators sidebar (Ctrl+Shift+C)"
                aria-label={
                  isSidebarVisible
                    ? "Hide active collaborators panel"
                    : "Show active collaborators panel"
                }
                style={{
                  borderRadius: "14px",
                  border: "1px solid rgba(71, 85, 105, 0.5)",
                  background: isSidebarVisible
                    ? "rgba(15, 23, 42, 0.5)"
                    : "rgba(71, 85, 105, 0.4)",
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
              >
                {isSidebarVisible ? "Hide collaborators" : "Show collaborators"}
              </button>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <ConnectionStatusBadge
                  status={collabState}
                  reconnectAttempt={reconnectAttempt}
                  reconnectDelay={reconnectDelay}
                  latency={latency}
                  onRetry={handleManualRetry}
                />
                <SyncStatusIndicator
                  status={syncStatus}
                  lastSyncTime={lastSyncTime}
                  showManualSync={import.meta.env.DEV}
                  onManualSync={
                    import.meta.env.DEV ? handleManualSync : undefined
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <main style={mainStyles}>
        {actionMessage && <div style={messageStyles}>{actionMessage}</div>}

        <div style={gridStylesDesktop}>
          <aside style={refinementPromptStyles}>
            <form onSubmit={handlePromptSubmit} style={formStyles}>
              <label htmlFor="refine-prompt" style={sectionTitleStyles}>
                Refinement prompt
              </label>
              <div
                  style={{
                  marginTop: "12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
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
          </aside>

          <section style={cardStyles}>
            <div style={controlsSectionStyles}>
              <div style={controlsHeaderStyles}>
                <div>
                  <h2 style={sectionTitleStyles}>Draft controls</h2>
                  <p style={sectionDescriptionStyles}>
                    Choose a template to generate a draft.
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

              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
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
                    // Skip if we're currently applying a remote update
                    if (isApplyingRemoteUpdateRef.current) {
                      return;
                    }
                    const newValue = event.target.value;
                    setDraftText(newValue);
                    
                    // Always try to apply to Y.js if provider exists and WebSocket is open
                    // The provider will handle whether to send based on isSynced internally
                    if (yjsRef.current && yjsRef.current.provider.ws?.readyState === WebSocket.OPEN) {
                      const provider = yjsRef.current.provider;
                      applyDiffToYText(newValue);
                      // Send typing indicator
                      provider.sendPresence();
                      // Clear previous timeout
                      if (typingTimeoutRef.current) {
                        clearTimeout(typingTimeoutRef.current);
                      }
                      // Set timeout to stop typing indicator after 2 seconds of inactivity
                      typingTimeoutRef.current = window.setTimeout(() => {
                        // Typing stopped - presence will be updated on next activity
                      }, 2000);
                    }
                  }}
                  rows={25}
                  style={{
                    ...textareaStyles,
                    flex: 1,
                    minHeight: "500px",
                    maxHeight: "none",
                    maxWidth: "100%",
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
                  {collabState === "connected" &&
                    (activeUsers.size > 0
                      ? `${activeUsers.size} collaborator${
                          activeUsers.size === 1 ? "" : "s"
                        } currently editing.`
                      : "Changes sync live to all collaborators in real-time.")}
                  {collabState === "connecting" &&
                    "Connecting to collaboration server..."}
                  {collabState === "reconnecting" &&
                    (collabStatusMessage ||
                      "Connection lost. Attempting to reconnect...")}
                  {collabState === "failed" &&
                    (collabStatusMessage ||
                      "Unable to reconnect. Please refresh to retry.")}
                  {collabState === "error" &&
                    (collabStatusMessage ||
                      "Collaboration offline. Changes will sync when connection is restored.")}
                  {collabState === "disconnected" &&
                    "Collaboration offline. Changes will sync when connection is restored."}
                </p>
              </div>
            </div>
          </section>

          {/* Active Users Panel - Third Column */}
          {documentId && documentId !== "draft" && isSidebarVisible && (
            <aside style={cardStyles}>
              <ActiveUsersSidebar
                activeUsers={activeUsers}
                currentUserId={user?.id}
                inline={true}
              />
            </aside>
          )}
        </div>

        <aside style={cardStyles}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
            <div>
              <h2 style={sectionTitleStyles}>Extracted text</h2>
          <p style={sectionDescriptionStyles}>
                Parsed from the uploaded document for reference during drafting.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsExtractedTextExpanded(!isExtractedTextExpanded)}
              aria-label={isExtractedTextExpanded ? "Collapse extracted text" : "Expand extracted text"}
            style={{
                borderRadius: "8px",
                border: "1px solid rgba(71, 85, 105, 0.5)",
                background: "rgba(15, 23, 42, 0.5)",
                padding: "6px 12px",
                fontSize: "12px",
                fontWeight: 500,
                color: "rgba(241, 245, 249, 0.9)",
                cursor: "pointer",
                transition: "border-color 0.2s ease, color 0.2s ease, background 0.2s ease",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(148, 163, 184, 0.6)";
                e.currentTarget.style.color = "#f8fafc";
                e.currentTarget.style.background = "rgba(15, 23, 42, 0.7)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.5)";
                e.currentTarget.style.color = "rgba(241, 245, 249, 0.9)";
                e.currentTarget.style.background = "rgba(15, 23, 42, 0.5)";
              }}
            >
              {isExtractedTextExpanded ? "−" : "+"}
            </button>
          </div>
          {isExtractedTextExpanded && (
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
          )}
        </aside>
      </main>
      {documentId && documentId !== "draft" && (
        <ShareModal
          documentId={documentId}
          isOpen={isShareModalOpen}
          onClose={() => setIsShareModalOpen(false)}
        />
      )}
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
    </CollaborationErrorBoundary>
  );
};

export default Editor;

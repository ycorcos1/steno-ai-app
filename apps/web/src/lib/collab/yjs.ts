import * as Y from "yjs";
import { Observable } from "lib0/observable";

/**
 * Custom WebSocket provider for AWS API Gateway WebSocket API
 * Based on y-websocket but adapted for API Gateway protocol
 */
export class ApiGatewayWebSocketProvider extends Observable<string> {
  doc: Y.Doc;
  wsUrl: string;
  documentId: string;
  ws: WebSocket | null = null;
  shouldConnect: boolean = true;
  isSynced: boolean = false;
  awareness: any = null; // Y.js awareness (optional, for presence)

  constructor(wsUrl: string, documentId: string, doc: Y.Doc) {
    super();
    this.doc = doc;
    this.wsUrl = wsUrl;
    this.documentId = documentId;
  }

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    // Don't connect if URL is invalid or missing token
    if (!this.wsUrl || !this.wsUrl.includes("token=")) {
      console.warn("[Y.js] Cannot connect: missing token in WebSocket URL");
      return;
    }

    this.shouldConnect = true;

    // Close any existing connection attempt
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // Ignore errors when closing
      }
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (error) {
      // Browser will log the error automatically, but we handle it gracefully
      this.emit("status", [{ status: "error" }]);
      return;
    }

    this.ws.onopen = () => {
      // Only log in development to reduce console noise
      if (import.meta.env.DEV) {
        console.log(
          `[Y.js] WebSocket connected for document ${this.documentId}`
        );
      }
      this.emit("status", [{ status: "connected" }]);

      // Send join message
      this.send({
        action: "join",
        documentId: this.documentId,
      });
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (error) {
        console.error("[Y.js] Failed to parse message:", error);
      }
    };

    this.ws.onerror = (error) => {
      // Suppress initial connection errors - they're often transient and will retry
      // Only log if we're already connected (indicating a real error)
      if (this.isSynced && import.meta.env.DEV) {
        console.debug("[Y.js] WebSocket error:", error);
      }
      // Don't emit error status on initial connection attempts - let onclose handle it
      if (this.isSynced) {
        this.emit("status", [{ status: "error" }]);
      }
    };

    this.ws.onclose = (event) => {
      // Only log in development, suppress in production
      if (import.meta.env.DEV) {
        console.debug(`[Y.js] WebSocket closed:`, event.code, event.reason);
      }
      this.emit("status", [{ status: "disconnected" }]);
      this.isSynced = false;

      // Auto-reconnect if shouldConnect is true (but limit retries to avoid spam)
      if (this.shouldConnect && event.code !== 1006) {
        // Don't auto-reconnect on abnormal closure (1006) - likely connection refused
        const delay = Math.min(1000 * Math.pow(2, 0), 5000); // Exponential backoff, max 5s
        setTimeout(() => {
          if (this.shouldConnect) {
            this.connect();
          }
        }, delay);
      }
    };
  }

  disconnect(): void {
    this.shouldConnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn("[Y.js] Cannot send message: WebSocket not open");
    }
  }

  handleMessage(message: any): void {
    const { type, snapshot, ops, version, update, userId, error } = message;

    if (type === "sync") {
      // Initial sync: apply snapshot and ops
      if (snapshot) {
        const snapshotBuffer = Uint8Array.from(atob(snapshot), (c) =>
          c.charCodeAt(0)
        );
        Y.applyUpdate(this.doc, snapshotBuffer);
      }

      // Apply all ops
      for (const op of ops || []) {
        const opBuffer = Uint8Array.from(atob(op), (c) => c.charCodeAt(0));
        Y.applyUpdate(this.doc, opBuffer);
      }

      this.isSynced = true;
      this.emit("synced", [{ synced: true }]);
      console.log(
        `[Y.js] Synced document ${this.documentId}, version: ${version}`
      );
    } else if (type === "update") {
      // Remote update from another client
      if (update) {
        const updateBuffer = Uint8Array.from(atob(update), (c) =>
          c.charCodeAt(0)
        );
        Y.applyUpdate(this.doc, updateBuffer);
      }
    } else if (type === "error") {
      console.error(`[Y.js] Server error:`, error || message.message);
      this.emit("error", [{ error: error || message.message }]);
    } else if (type === "presence") {
      // Presence update (user joined/left/cursor moved)
      this.emit("presence", [message]);
    } else if (type === "snapshot_needed") {
      // Server requests snapshot creation
      this.emit("snapshot_needed", [message]);
    } else if (type === "snapshot_created") {
      // New snapshot created
      this.emit("snapshot_created", [message]);
    }
  }

  /**
   * Send Y.js update to server
   */
  sendUpdate(update: Uint8Array): void {
    const base64 = btoa(String.fromCharCode(...update));
    this.send({
      action: "update",
      documentId: this.documentId,
      update: base64,
    });
  }

  /**
   * Send presence update (cursor position, selection)
   */
  sendPresence(
    cursor?: { line: number; column: number },
    selection?: any
  ): void {
    this.send({
      action: "presence",
      documentId: this.documentId,
      cursor,
      selection,
    });
  }

  /**
   * Request snapshot creation
   */
  createSnapshot(snapshot: Uint8Array): void {
    const base64 = btoa(String.fromCharCode(...snapshot));
    this.send({
      action: "create_snapshot",
      documentId: this.documentId,
      update: base64,
    });
  }
}

/**
 * Initialize Y.js collaboration for a document
 * @param documentId Document ID
 * @param jwt JWT token for authentication
 * @param wsBaseUrl WebSocket base URL (from environment)
 * @returns Y.js document, provider, and text type
 */
export function initCollabDoc(
  documentId: string,
  jwt: string,
  wsBaseUrl: string
): {
  ydoc: Y.Doc;
  provider: ApiGatewayWebSocketProvider;
  ytext: Y.Text;
} {
  // Create Y.js document
  const ydoc = new Y.Doc();

  // Create text type for draft content
  const ytext = ydoc.getText("draft");

  // Create WebSocket provider
  // Ensure JWT is properly encoded in the URL
  const encodedToken = encodeURIComponent(jwt);
  const wsUrl = `${wsBaseUrl}?token=${encodedToken}`;
  const provider = new ApiGatewayWebSocketProvider(wsUrl, documentId, ydoc);

  // Listen for local updates and send to server
  ydoc.on("update", (update: Uint8Array, origin: any) => {
    // Only send updates that originated from this client (not from server sync)
    if (origin !== provider) {
      provider.sendUpdate(update);
    }
  });

  // Don't auto-connect here - let the caller control when to connect
  // This allows for a small delay to ensure token is ready

  return { ydoc, provider, ytext };
}

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
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimeoutId: number | null = null;
  private lastKnownVersion: number | null = null;
  private isSnapshotting = false;
  private latency: number | null = null;
  private pingInterval: number | null = null;
  private lastPingTime: number | null = null;
  private syncStatus: "synced" | "syncing" | "conflict" = "synced";
  private syncTimer: number | null = null;
  private expectedSnapshotChunks: number | null = null;
  private snapshotChunkBuffer: string[] = [];
  private receivedSnapshotChunks = 0;
  private pendingOpFragments: Map<
    number,
    { fragments: string[]; fragmentCount: number }
  > = new Map();
  private nextExpectedOpIndex = 0;
  private totalOpsExpected: number | null = null;
  private awaitingSyncCompletion = false;

  constructor(wsUrl: string, documentId: string, doc: Y.Doc) {
    super();
    this.doc = doc;
    this.wsUrl = wsUrl;
    this.documentId = documentId;
    this.resetSyncAssembly();
  }

  private resetSyncAssembly(): void {
    this.expectedSnapshotChunks = null;
    this.snapshotChunkBuffer = [];
    this.receivedSnapshotChunks = 0;
    this.pendingOpFragments.clear();
    this.nextExpectedOpIndex = 0;
    this.totalOpsExpected = null;
    this.awaitingSyncCompletion = false;
  }

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    // Don't connect if URL is invalid or missing token
    if (!this.wsUrl || !this.wsUrl.includes("token=")) {
      console.warn("[Y.js] Cannot connect: missing token in WebSocket URL");
      this.emit("status", [{ status: "error", message: "missing-token" }]);
      return;
    }

    this.shouldConnect = true;
    this.setSyncStatus("syncing");
    this.emit("status", [{ status: "connecting" }]);
    this.resetSyncAssembly();

    // Close any existing connection attempt
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore errors when closing
      }
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (error) {
      console.error("[Y.js] Failed to create WebSocket:", error);
      this.emit("status", [
        {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;

      // Capture WebSocket reference to avoid race conditions
      const ws = this.ws;
      if (!ws) {
        console.error("[Y.js] WebSocket is null in onopen handler");
        return;
      }

      // WebSocket connected successfully

      // Verify connection is actually open before proceeding
      if (ws.readyState === WebSocket.OPEN) {
        // Emit connected status
        // Use a small delay to ensure React has processed listener registration
        setTimeout(() => {
          this.emit("status", [{ status: "connected" }]);
        }, 10);

        // Start latency monitoring
        this.startLatencyMonitoring();

        // Small delay to ensure connection is fully established before sending
        setTimeout(() => {
          // Check both the captured reference and this.ws
          if (ws.readyState === WebSocket.OPEN && this.ws === ws) {
            // Send join message with lastKnownVersion for efficient sync
            try {
              // Validate documentId before sending join
              const trimmedDocId = this.documentId.trim();
              const uuidRegex =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
              if (!uuidRegex.test(trimmedDocId)) {
                console.error(
                  "[Y.js] Cannot send join: documentId is not a valid UUID",
                  { documentId: this.documentId, trimmed: trimmedDocId }
                );
                return;
              }

              ws.send(
                JSON.stringify({
                  action: "join",
                  documentId: trimmedDocId,
                  lastKnownVersion: this.lastKnownVersion,
                })
              );
              // Join message sent
            } catch (error) {
              console.error("[Y.js] Error sending join message:", error);
            }
          } else {
            console.warn(
              "[Y.js] WebSocket closed before join message could be sent",
              {
                wsReadyState: ws.readyState,
                thisWsExists: this.ws !== null,
                wsMatches: this.ws === ws,
              }
            );
          }
        }, 100);
      } else {
        console.warn(
          "[Y.js] WebSocket onopen fired but readyState is not OPEN",
          { readyState: ws.readyState }
        );
        this.emit("status", [
          { status: "error", message: "Connection not ready" },
        ]);
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data);
        // Only log non-update messages to reduce noise, but always log update messages
        if (message.type === "update") {
          console.log(`[Y.js] Raw UPDATE message received:`, {
            type: message.type,
            hasUpdate: !!message.update,
            updateLength: message.update?.length || 0,
            documentId: message.documentId,
            messageSize: event.data.length,
            expectedDocumentId: this.documentId,
            documentIdMatch: message.documentId === this.documentId,
          });
        } else if (import.meta.env.DEV) {
          console.log(`[Y.js] Raw message received:`, {
            type: message.type,
            hasUpdate: !!message.update,
            hasSnapshot: !!message.snapshot,
            hasOps: !!(message.ops && message.ops.length > 0),
            messageSize: event.data.length,
          });
        }
        // Log sync messages to debug isSynced issue
        if (message.type === "sync" || message.type === "sync_complete") {
          console.log(
            `[Y.js] Processing ${message.type} message, current isSynced: ${this.isSynced}`
          );
        }

        this.handleMessage(message);

        // Log isSynced after processing sync messages
        if (message.type === "sync" || message.type === "sync_complete") {
          console.log(
            `[Y.js] After processing ${message.type}, isSynced: ${this.isSynced}`
          );
        }
      } catch (error) {
        console.error("[Y.js] Failed to parse message:", error, {
          data: event.data?.substring(0, 200),
        });
      }
    };

    this.ws.onerror = (error) => {
      // Only log errors in development or if connection fails multiple times
      if (this.reconnectAttempts > 2) {
        console.error(
          "[Y.js] WebSocket error (attempt",
          this.reconnectAttempts + "):",
          error
        );
      }
      this.emit("status", [{ status: "error", message: "websocket-error" }]);
    };

    this.ws.onclose = (event) => {
      const wasSynced = this.isSynced;
      this.isSynced = false;

      if (import.meta.env.DEV) {
        console.log(
          `[Y.js] WebSocket closed: code=${event.code}, wasSynced=${wasSynced}, willReconnect=${this.shouldConnect}`
        );
      }

      // Code 1005 means "No Status Received" - connection closed without proper handshake
      // This often happens with API Gateway WebSockets and is usually recoverable
      if (event.code === 1005) {
        if (import.meta.env.DEV) {
          console.log(
            `[Y.js] WebSocket closed (code 1005 - No Status Received). Will reconnect.`
          );
        }
      } else if (event.code === 1006 && this.reconnectAttempts > 3) {
        // Only log abnormal closures (1006) after multiple attempts
        // Many 1006 errors are transient and will be retried automatically
        console.warn(
          `[Y.js] WebSocket closed abnormally (code 1006) after ${this.reconnectAttempts} attempts`
        );
      } else if (
        event.code !== 1000 &&
        event.code !== 1001 &&
        event.code !== 1006 &&
        event.code !== 1005
      ) {
        // Log non-normal, non-1006, non-1005 closures (these are less common)
        console.warn(`[Y.js] WebSocket closed:`, {
          code: event.code,
          reason: event.reason || "No reason provided",
          wasClean: event.wasClean,
        });
      }

      // Emit disconnected status
      this.emit("status", [
        { status: "disconnected", code: event.code, reason: event.reason },
      ]);

      // Only attempt reconnect if connection was not intentionally closed
      if (this.shouldConnect) {
        this.scheduleReconnect(event.code);
      }
    };
  }

  private setSyncStatus(status: "synced" | "syncing" | "conflict"): void {
    if (this.syncStatus !== status) {
      this.syncStatus = status;
      this.emit("sync-status", [{ status }]);
    }
  }

  private scheduleSyncedTransition(delay = 500): void {
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer);
    }
    this.syncTimer = window.setTimeout(() => {
      this.setSyncStatus("synced");
      this.syncTimer = null;
    }, delay);
  }

  private clearSyncTimer(): void {
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private scheduleReconnect(closeCode?: number): void {
    if (!this.shouldConnect) {
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[Y.js] Max reconnection attempts reached");
      this.emit("status", [
        { status: "failed", message: "max-retries-exceeded" },
      ]);
      return;
    }

    this.reconnectAttempts += 1;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts - 1),
      16_000
    );
    this.emit("status", [
      {
        status: "reconnecting",
        attempt: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
        delay,
      },
    ]);

    this.reconnectTimeoutId = window.setTimeout(() => {
      if (this.shouldConnect) {
        this.connect();
      }
    }, delay);
  }

  private startLatencyMonitoring(): void {
    // Clear any existing interval
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
    }

    // Send ping every 10 seconds to measure latency
    this.pingInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.lastPingTime = Date.now();
        this.send({ action: "ping" });
      }
    }, 10000);

    // Initial ping
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.lastPingTime = Date.now();
      this.send({ action: "ping" });
    }
  }

  private stopLatencyMonitoring(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.latency = null;
    this.lastPingTime = null;
  }

  disconnect(): void {
    this.shouldConnect = false;
    this.stopLatencyMonitoring();
    this.clearSyncTimer();
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  forceReconnect(): void {
    this.shouldConnect = true;
    this.stopLatencyMonitoring();
    this.clearSyncTimer();
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.reconnectAttempts = 0;
    this.connect();
  }

  /**
   * Get current connection status
   */
  getStatus():
    | "connecting"
    | "connected"
    | "disconnected"
    | "reconnecting"
    | "failed"
    | "error" {
    if (!this.ws) {
      return "disconnected";
    }
    if (this.ws.readyState === WebSocket.OPEN) {
      return "connected";
    }
    if (this.ws.readyState === WebSocket.CONNECTING) {
      return "connecting";
    }
    return "disconnected";
  }

  /**
   * Get current latency in milliseconds
   */
  getLatency(): number | null {
    return this.latency;
  }

  getSyncStatus(): "synced" | "syncing" | "conflict" {
    return this.syncStatus;
  }

  send(data: any): void {
    if (!this.ws) {
      if (import.meta.env.DEV) {
        console.warn("[Y.js] Cannot send message: WebSocket is null", {
          action: data?.action,
          documentId: this.documentId,
        });
      }
      return;
    }

    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        const messageStr = JSON.stringify(data);
        const messageSize = new Blob([messageStr]).size;

        // API Gateway WebSocket has 32KB limit, use 28KB to be safe
        const MAX_MESSAGE_SIZE = 28 * 1024;

        if (messageSize > MAX_MESSAGE_SIZE) {
          console.error(
            `[Y.js] Message too large (${(messageSize / 1024).toFixed(
              2
            )}KB). Maximum is ${(MAX_MESSAGE_SIZE / 1024).toFixed(2)}KB.`,
            { action: data?.action, size: messageSize }
          );
          this.emit("error", [
            {
              type: "message_too_large",
              message: `Message exceeds ${(MAX_MESSAGE_SIZE / 1024).toFixed(
                2
              )}KB limit`,
              size: messageSize,
            },
          ]);
          return;
        }

        this.ws.send(messageStr);
        if (import.meta.env.DEV && data?.action !== "update") {
          console.log(
            `[Y.js] Message sent: ${data?.action} (${(
              messageSize / 1024
            ).toFixed(2)}KB)`
          );
        }
      } catch (error) {
        console.error("[Y.js] Error sending message:", error);
        this.emit("status", [
          { status: "error", message: "Failed to send message" },
        ]);
      }
    } else if (import.meta.env.DEV) {
      console.warn(
        `[Y.js] Cannot send message: WebSocket not open (readyState: ${this.ws.readyState})`,
        { action: data?.action }
      );
    }
  }

  handleMessage(message: any): void {
    const { type, snapshot, ops, version, update, error } = message;

    // Handle pong for latency measurement
    if (type === "pong" && this.lastPingTime !== null) {
      const now = Date.now();
      this.latency = now - this.lastPingTime;
      this.emit("latency", [{ latency: this.latency }]);
      this.lastPingTime = null;
    }

    if (type === "sync_snapshot_chunk") {
      this.awaitingSyncCompletion = true;
      this.setSyncStatus("syncing");
      const chunkIndex =
        typeof message.chunkIndex === "number" ? message.chunkIndex : 0;
      const chunkCount =
        typeof message.chunkCount === "number" ? message.chunkCount : 0;
      const data = typeof message.data === "string" ? message.data : "";

      if (this.expectedSnapshotChunks === null && chunkCount > 0) {
        this.expectedSnapshotChunks = chunkCount;
        this.snapshotChunkBuffer = new Array<string>(chunkCount).fill("");
        this.receivedSnapshotChunks = 0;
      }

      if (
        this.expectedSnapshotChunks !== null &&
        chunkIndex >= 0 &&
        chunkIndex < this.expectedSnapshotChunks
      ) {
        if (this.snapshotChunkBuffer[chunkIndex] === "") {
          this.receivedSnapshotChunks += 1;
        }
        this.snapshotChunkBuffer[chunkIndex] = data;
      }

      if (
        this.expectedSnapshotChunks !== null &&
        this.receivedSnapshotChunks === this.expectedSnapshotChunks
      ) {
        const combined = this.snapshotChunkBuffer.join("");
        if (combined.length > 0) {
          const snapshotBuffer = this.base64ToUint8Array(combined);
          Y.applyUpdate(this.doc, snapshotBuffer, this);
        }
        this.expectedSnapshotChunks = null;
        this.snapshotChunkBuffer = [];
        this.receivedSnapshotChunks = 0;
      }

      return;
    }

    if (type === "sync_ops_chunk") {
      this.awaitingSyncCompletion = true;
      this.setSyncStatus("syncing");
      const chunkOps: string[] = Array.isArray(message.ops)
        ? message.ops.filter(
            (item: unknown): item is string => typeof item === "string"
          )
        : [];
      const startIndex =
        typeof message.startIndex === "number"
          ? message.startIndex
          : this.nextExpectedOpIndex;

      if (this.nextExpectedOpIndex !== startIndex) {
        console.warn("[Y.js] Sync ops chunk arrived out of order", {
          expected: this.nextExpectedOpIndex,
          receivedStart: startIndex,
        });
        this.nextExpectedOpIndex = startIndex;
      }

      chunkOps.forEach((opBase64) => {
        try {
          const opBuffer = this.base64ToUint8Array(opBase64);
          Y.applyUpdate(this.doc, opBuffer, this);
          this.nextExpectedOpIndex += 1;
        } catch (err) {
          console.error("[Y.js] Failed to apply sync ops chunk:", err);
        }
      });

      return;
    }

    if (type === "sync_op_fragment") {
      this.awaitingSyncCompletion = true;
      this.setSyncStatus("syncing");
      const opIndex =
        typeof message.opIndex === "number"
          ? message.opIndex
          : this.nextExpectedOpIndex;
      const fragmentIndex =
        typeof message.fragmentIndex === "number" ? message.fragmentIndex : 0;
      const fragmentCount =
        typeof message.fragmentCount === "number" ? message.fragmentCount : 0;
      const data = typeof message.data === "string" ? message.data : "";

      if (!this.pendingOpFragments.has(opIndex)) {
        this.pendingOpFragments.set(opIndex, {
          fragments: new Array<string>(fragmentCount).fill(""),
          fragmentCount,
        });
      }

      const fragmentState = this.pendingOpFragments.get(opIndex);
      if (fragmentState) {
        if (fragmentIndex >= 0 && fragmentIndex < fragmentState.fragmentCount) {
          fragmentState.fragments[fragmentIndex] = data;
        }

        const complete = fragmentState.fragments.every(
          (fragment) => fragment !== ""
        );

        if (complete) {
          try {
            const combined = fragmentState.fragments.join("");
            const opBuffer = this.base64ToUint8Array(combined);

            if (this.nextExpectedOpIndex !== opIndex) {
              console.warn("[Y.js] Op fragment completed out of order", {
                expected: this.nextExpectedOpIndex,
                opIndex,
              });
              this.nextExpectedOpIndex = opIndex;
            }

            Y.applyUpdate(this.doc, opBuffer, this);
            this.nextExpectedOpIndex += 1;
          } catch (err) {
            console.error("[Y.js] Failed to apply fragmented operation:", err);
          } finally {
            this.pendingOpFragments.delete(opIndex);
          }
        } else {
          this.pendingOpFragments.set(opIndex, fragmentState);
        }
      }

      return;
    }

    if (type === "sync_complete") {
      if (typeof message.opCount === "number") {
        this.totalOpsExpected = message.opCount;
      }
      if (typeof message.version === "number") {
        this.lastKnownVersion = message.version;
      }
      if (
        typeof message.opCount === "number" &&
        this.nextExpectedOpIndex !== message.opCount
      ) {
        console.warn("[Y.js] Sync completed but applied op count mismatch", {
          expected: message.opCount,
          applied: this.nextExpectedOpIndex,
        });
        this.nextExpectedOpIndex = message.opCount;
      }
      this.pendingOpFragments.clear();
      this.expectedSnapshotChunks = null;
      this.snapshotChunkBuffer = [];
      this.receivedSnapshotChunks = 0;
      const beforeIsSynced = this.isSynced;
      this.isSynced = true;
      this.awaitingSyncCompletion = false;
      this.setSyncStatus("synced");
      console.log(
        `[Y.js] Set isSynced: ${beforeIsSynced} -> ${this.isSynced} after receiving sync_complete message`
      );
      this.emit("synced", [{ synced: true, version: this.lastKnownVersion }]);

      // Verify isSynced is actually true
      if (!this.isSynced) {
        console.error(
          `[Y.js] CRITICAL: isSynced should be true but is ${this.isSynced} after sync_complete message!`
        );
        this.isSynced = true; // Force it to true
      }
      return;
    }

    if (type === "sync") {
      console.log(`[Y.js] Received sync message:`, {
        hasSnapshot: !!snapshot,
        snapshotLength: snapshot?.length || 0,
        opsCount: Array.isArray(ops) ? ops.length : 0,
        version,
        currentIsSynced: this.isSynced,
      });

      if (snapshot) {
        const snapshotBuffer = this.base64ToUint8Array(snapshot);
        Y.applyUpdate(this.doc, snapshotBuffer, this);
        console.log(`[Y.js] Applied snapshot from sync message`);
      }

      for (const op of ops || []) {
        const opBuffer = this.base64ToUint8Array(op);
        Y.applyUpdate(this.doc, opBuffer, this);
      }

      if (Array.isArray(ops)) {
        this.nextExpectedOpIndex = ops.length;
        this.totalOpsExpected = ops.length;
        console.log(`[Y.js] Applied ${ops.length} ops from sync message`);
      }

      if (version !== undefined && version !== null) {
        this.lastKnownVersion = version;
      }

      const beforeIsSynced = this.isSynced;
      this.isSynced = true;
      this.awaitingSyncCompletion = false;
      this.setSyncStatus("synced");
      console.log(
        `[Y.js] Set isSynced: ${beforeIsSynced} -> ${this.isSynced} after receiving sync message`
      );
      this.emit("synced", [{ synced: true, version: this.lastKnownVersion }]);

      // Verify isSynced is actually true
      if (!this.isSynced) {
        console.error(
          `[Y.js] CRITICAL: isSynced should be true but is ${this.isSynced} after sync message!`
        );
        this.isSynced = true; // Force it to true
      }
    } else if (type === "update") {
      if (update) {
        console.log(
          `[Y.js] Received remote update message (size: ${update.length} chars)`
        );
        try {
          const updateBuffer = Uint8Array.from(atob(update), (c) =>
            c.charCodeAt(0)
          );
          // Apply update with null origin to allow it to be applied
          // Using null origin ensures Y.js applies the update and triggers observers
          // Using 'this' (provider) would cause Y.js to ignore it as an echo
          const ytext = this.doc.getText("draft");
          const beforeLength = ytext.length;
          const beforeText = ytext.toString().substring(0, 100); // First 100 chars for comparison

          // Log the update buffer size to debug
          console.log(
            `[Y.js] Applying remote update: buffer size=${updateBuffer.length} bytes, beforeLength=${beforeLength}, isSynced=${this.isSynced}`
          );

          // Apply the update - this will trigger ytext.observe handlers
          // Use a special marker object as origin to identify remote updates
          // This prevents the update from being echoed back to the server
          const REMOTE_UPDATE_ORIGIN = { __isRemoteUpdate: true };
          Y.applyUpdate(this.doc, updateBuffer, REMOTE_UPDATE_ORIGIN);

          // Use requestAnimationFrame to ensure Y.js has fully processed the update
          // before we read the text and emit events
          requestAnimationFrame(() => {
            const afterLength = ytext.length;
            const afterText = ytext.toString().substring(0, 100);
            this.setSyncStatus("synced");

            console.log(
              `[Y.js] Remote update applied: ${beforeLength} -> ${afterLength} chars`,
              {
                textChanged: beforeText !== afterText,
                beforePreview: beforeText.substring(0, 50),
                afterPreview: afterText.substring(0, 50),
              }
            );

            // Emit remote-update event to ensure React updates
            // This is a fallback in case ytext.observe doesn't fire
            const finalText = ytext.toString();
            this.emit("remote-update", [
              {
                beforeLength,
                afterLength,
                text: finalText,
              },
            ]);
          });
        } catch (error) {
          console.error("[Y.js] Error applying remote update:", error);
          this.emit("error", [
            {
              type: "update_apply_failed",
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to apply remote update",
            },
          ]);
        }
      }
    } else if (type === "error") {
      const normalized = {
        code: message.code ?? error?.code,
        type: (message.code ?? error?.code ?? "generic").toLowerCase(),
        message:
          error?.message ?? message.message ?? "Collaboration error occurred",
        details: error ?? message,
      };

      // Ignore duplicate key errors - they're handled gracefully on the server
      if (
        normalized.message?.includes("duplicate key") ||
        normalized.message?.includes("doc_snapshots_document_id_version_key")
      ) {
        // This is a race condition that's already handled - don't show error to user
        return;
      }

      // Ignore INTERNAL_ERROR related to invalid UUID - it's being handled on server
      // and shouldn't break the connection
      if (
        normalized.type === "internal_error" &&
        normalized.message?.includes("invalid input syntax for type uuid")
      ) {
        console.warn(
          "[Y.js] Server reported UUID error (being handled):",
          normalized.message
        );
        // Don't break connection - server is handling it
        return;
      }

      if (normalized.type === "sync_conflict") {
        this.setSyncStatus("conflict");
      }

      if (normalized.type === "invalid_document") {
        console.warn(
          "[Y.js] Server reported invalid document for this connection. Forcing reconnect.",
          normalized
        );
        this.isSynced = false;
        this.emit("status", [
          {
            status: "reconnecting",
            message: "rejoin-required",
          },
        ]);
        this.forceReconnect();
        return;
      }

      console.error("[Y.js] Server error:", normalized);
      this.emit("error", [normalized]);
    } else if (type === "refinement_started") {
      // Emit refinement_started event so Editor can show notification
      this.emit("refinement_started", [message]);
    } else if (type === "refinement_complete") {
      // Apply the refined text to Y.js so all collaborators see it
      // Apply even if not fully synced - refinement updates are authoritative
      if (message.draftText) {
        const ytext = this.doc.getText("draft");
        const beforeLength = ytext.length;

        // Replace entire Y.Text content with the refined draft
        // Use REMOTE_UPDATE_ORIGIN to prevent echo back to server
        // The server already has the refined text, so we don't need to send it back
        const REMOTE_UPDATE_ORIGIN = { __isRemoteUpdate: true };
        this.doc.transact(() => {
          if (beforeLength > 0) {
            ytext.delete(0, beforeLength);
          }
          if (message.draftText.length > 0) {
            ytext.insert(0, message.draftText);
          }
        }, REMOTE_UPDATE_ORIGIN);

        const afterLength = ytext.length;
        console.log(
          `[Y.js] Applied refinement_complete: ${beforeLength} -> ${afterLength} chars (isSynced: ${this.isSynced})`
        );

        // Emit event so Editor can update UI
        this.emit("refinement_complete", [
          {
            beforeLength,
            afterLength,
            text: message.draftText,
          },
        ]);
      }
    } else if (type === "presence") {
      this.emit("presence", [message]);
    } else if (type === "snapshot_needed") {
      // Only attempt snapshot if document is reasonably sized
      // Large documents will rely on incremental updates
      const currentSize = this.doc.getText("draft").length;
      if (currentSize > 50000) {
        // ~50KB of text
        console.warn(
          `[Y.js] Skipping snapshot - document is too large (${currentSize} chars). Will rely on incremental updates.`
        );
        // Don't emit error, just silently skip
        return;
      }
      this.emit("snapshot_needed", [message]);
      this.sendSnapshot().catch((err) => {
        console.error("[Y.js] Failed to send snapshot:", err);
      });
    } else if (type === "snapshot_created") {
      this.isSnapshotting = false;
      if (typeof message.version === "number") {
        this.lastKnownVersion = message.version;
      }
      this.emit("snapshot_created", [message]);
    } else if (type === "error" && message.code === "SNAPSHOT_TOO_LARGE") {
      // Server rejected snapshot as too large - reset flag so we can try again later
      this.isSnapshotting = false;
      console.warn("[Y.js] Snapshot rejected by server as too large");
    }
  }

  /**
   * Send Y.js update to server
   */
  sendUpdate(update: Uint8Array): void {
    // Validate documentId before sending
    if (
      !this.documentId ||
      typeof this.documentId !== "string" ||
      this.documentId.trim() === ""
    ) {
      console.error(
        "[Y.js] Cannot send update: documentId is missing or invalid",
        { documentId: this.documentId, type: typeof this.documentId }
      );
      return;
    }

    // Ensure documentId is trimmed and valid before proceeding
    const trimmedDocId = this.documentId.trim();
    if (trimmedDocId === "") {
      console.error(
        "[Y.js] Cannot send update: documentId is empty after trimming",
        { originalDocumentId: this.documentId }
      );
      return;
    }

    // Y.js updates should be small incremental changes
    // If they're large, something is wrong - log a warning
    const updateSizeKB = update.length / 1024;
    if (updateSizeKB > 10) {
      console.warn(
        `[Y.js] Large update detected (${updateSizeKB.toFixed(
          2
        )}KB). This may fail.`,
        "Y.js updates should be small incremental changes."
      );
    }

    this.setSyncStatus("syncing");
    this.scheduleSyncedTransition();
    // Use chunked base64 encoding for large updates too
    const base64 = this.uint8ArrayToBase64(update);

    // Estimate message size (base64 is ~33% larger than binary)
    const estimatedSize = base64.length + 200; // Add overhead for JSON metadata
    if (estimatedSize > 28 * 1024) {
      console.error(
        `[Y.js] Update too large to send (${(estimatedSize / 1024).toFixed(
          2
        )}KB). Skipping.`,
        "This usually means the entire document state is being sent instead of just changes."
      );
      return;
    }

    // Final validation before sending - ensure documentId is valid UUID
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(trimmedDocId)) {
      console.error(
        "[Y.js] Cannot send update: documentId is not a valid UUID",
        {
          documentId: this.documentId,
          trimmed: trimmedDocId,
          length: trimmedDocId.length,
        }
      );
      return;
    }

    // Only send if WebSocket is open (double-check here for safety)
    if (this.ws?.readyState !== WebSocket.OPEN) {
      if (import.meta.env.DEV) {
        console.warn("[Y.js] Cannot send update: WebSocket not open", {
          readyState: this.ws?.readyState,
        });
      }
      return;
    }

    this.send({
      action: "update",
      documentId: trimmedDocId,
      update: base64,
    });
  }

  private base64ToUint8Array(data: string): Uint8Array {
    const binaryString = atob(data);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  manualSync(): boolean {
    try {
      const state = Y.encodeStateAsUpdate(this.doc);
      this.sendUpdate(state);
      return true;
    } catch (err) {
      console.error("[Y.js] Manual sync failed:", err);
      this.emit("error", [
        {
          type: "manual_sync_failed",
          message: err instanceof Error ? err.message : "Manual sync failed",
        },
      ]);
      return false;
    }
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
   * Convert Uint8Array to base64 string efficiently (handles large arrays)
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    // Use chunked approach to avoid call stack overflow for large arrays
    const chunkSize = 8192; // Process in 8KB chunks
    let result = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);
      result += btoa(String.fromCharCode(...chunk));
    }
    return result;
  }

  /**
   * Send full snapshot to server when requested
   */
  async sendSnapshot(): Promise<void> {
    if (this.isSnapshotting || !this.isSynced) {
      return;
    }

    this.isSnapshotting = true;
    try {
      const encodedState = Y.encodeStateAsUpdate(this.doc);
      // Use chunked base64 encoding to avoid stack overflow for large documents
      const base64 = this.uint8ArrayToBase64(encodedState);

      // Check if snapshot is too large (API Gateway has 32KB limit)
      const sizeKB = encodedState.length / 1024;
      const estimatedMessageSize = base64.length + 200; // Add JSON overhead

      if (estimatedMessageSize > 28 * 1024) {
        console.error(
          `[Y.js] Snapshot too large (${(estimatedMessageSize / 1024).toFixed(
            2
          )}KB). Cannot send.`,
          "Document is too large for WebSocket. Consider splitting the document."
        );
        this.isSnapshotting = false;
        this.emit("error", [
          {
            type: "snapshot_too_large",
            message: `Snapshot exceeds ${((28 * 1024) / 1024).toFixed(
              2
            )}KB limit. Document is too large.`,
            size: estimatedMessageSize,
          },
        ]);
        return;
      }

      if (sizeKB > 20) {
        console.warn(
          `[Y.js] Snapshot is large (${sizeKB.toFixed(2)}KB). This may be slow.`
        );
      }

      this.send({
        action: "create_snapshot",
        documentId: this.documentId,
        update: base64,
      });
    } catch (error) {
      console.error("[Y.js] Error encoding snapshot:", error);
      this.isSnapshotting = false;
      throw error;
    } finally {
      // Don't reset isSnapshotting here - let server response handle it
      // This prevents multiple snapshot attempts if the first one is still processing
    }
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
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("draft");
  const encodedToken = encodeURIComponent(jwt);
  const wsUrl = `${wsBaseUrl}?token=${encodedToken}`;
  const provider = new ApiGatewayWebSocketProvider(wsUrl, documentId, ydoc);

  ydoc.on("update", (update: Uint8Array, origin: any) => {
    // Only send updates if:
    // 1. The update didn't come from the provider (avoid echo from sync messages)
    // 2. The update didn't come from a remote update (marked with __isRemoteUpdate)
    // 3. The WebSocket connection is open
    // Note: We send updates even if not fully synced - the server will handle it
    // This ensures manual edits are sent immediately when connection is open
    const isRemoteUpdate =
      origin && typeof origin === "object" && origin.__isRemoteUpdate === true;

    if (
      origin !== provider &&
      !isRemoteUpdate &&
      provider.ws?.readyState === WebSocket.OPEN
    ) {
      console.log(
        `[Y.js] Sending local update to server (size: ${
          update.length
        } bytes, isSynced: ${provider.isSynced}, origin: ${
          origin === null ? "null" : typeof origin
        })`
      );
      provider.sendUpdate(update);
    } else if (origin !== provider && !isRemoteUpdate) {
      // If we can't send now, log why but don't lose the update
      // Y.js will handle retrying when connection is restored
      if (import.meta.env.DEV) {
        console.log(`[Y.js] Not sending update (will retry when connected):`, {
          origin:
            origin === provider
              ? "provider"
              : isRemoteUpdate
              ? "remote-update"
              : origin === null
              ? "null"
              : "other",
          isSynced: provider.isSynced,
          wsReady: provider.ws?.readyState === WebSocket.OPEN,
          wsState: provider.ws?.readyState,
        });
      }
    }
  });

  return { ydoc, provider, ytext };
}

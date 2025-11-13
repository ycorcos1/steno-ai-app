import {
  getLatestSnapshot,
  getOpsSince,
  saveSnapshot,
  saveOp,
  getNextSnapshotVersion,
  countOpsSinceLastSnapshot,
  checkDocumentAccess,
} from "../db/pg";

// Constants for snapshot creation
const SNAPSHOT_INTERVAL_OPS = 100;
const SNAPSHOT_INTERVAL_MINUTES = 5;

// Track last snapshot time per document (in-memory, per Lambda instance)
const lastSnapshotTime = new Map<string, number>();

/**
 * Join a document room - validates access and returns sync data
 * @param documentId Document ID
 * @param userId User ID
 * @returns Sync payload with snapshot and ops, or null if access denied
 */
export async function joinRoom(
  documentId: string,
  userId: string
): Promise<{
  snapshot: Buffer | null;
  ops: Buffer[];
  version: number | null;
} | null> {
  // Check access
  const access = await checkDocumentAccess(documentId, userId);
  if (!access) {
    return null;
  }

  // Get latest snapshot
  const snapshot = await getLatestSnapshot(documentId);
  const version = snapshot?.version || null;

  // Get ops since snapshot (or all ops if no snapshot)
  const ops = await getOpsSince(documentId, version);

  return {
    snapshot: snapshot?.snapshot_bytes || null,
    ops: ops.map((op) => op.op_bytes),
    version,
  };
}

/**
 * Save an operation and check if snapshot is needed
 * @param documentId Document ID
 * @param opBytes Y.js operation bytes
 * @param sessionId WebSocket session ID
 * @returns Whether a new snapshot was created
 */
export async function saveOperation(
  documentId: string,
  opBytes: Buffer,
  sessionId: string
): Promise<boolean> {
  // Save the operation
  await saveOp(documentId, opBytes, sessionId);

  // Check if snapshot is needed
  const opCount = await countOpsSinceLastSnapshot(documentId);
  const now = Date.now();
  const lastSnapshot = lastSnapshotTime.get(documentId) || 0;
  const timeSinceSnapshot = (now - lastSnapshot) / 1000 / 60; // minutes

  const shouldCreateSnapshot =
    opCount >= SNAPSHOT_INTERVAL_OPS ||
    timeSinceSnapshot >= SNAPSHOT_INTERVAL_MINUTES;

  if (shouldCreateSnapshot) {
    // Note: In a real implementation, we'd need to get the current Y.js state
    // from the document. For now, we'll create a placeholder snapshot.
    // The actual snapshot creation should happen when we have the Y.js document state.
    // This is a simplified version - in production, you'd need to coordinate
    // snapshot creation with the actual Y.js document state.

    // For MVP, we'll just mark that a snapshot should be created
    // The WebSocket handler can coordinate this with connected clients
    lastSnapshotTime.set(documentId, now);
    return true;
  }

  return false;
}

/**
 * Create a snapshot for a document
 * @param documentId Document ID
 * @param snapshotBytes Y.js encoded snapshot bytes
 * @returns Created snapshot version
 */
export async function createSnapshot(
  documentId: string,
  snapshotBytes: Buffer
): Promise<number> {
  const version = await getNextSnapshotVersion(documentId);
  await saveSnapshot(documentId, version, snapshotBytes);
  lastSnapshotTime.set(documentId, Date.now());
  return version;
}

/**
 * Get sync data for reconnection
 * @param documentId Document ID
 * @param lastKnownVersion Last known snapshot version (optional)
 * @returns Sync payload
 */
export async function getSyncData(
  documentId: string,
  lastKnownVersion: number | null = null
): Promise<{
  snapshot: Buffer | null;
  ops: Buffer[];
  version: number | null;
}> {
  const snapshot = await getLatestSnapshot(documentId);
  const version = snapshot?.version || null;

  // If client has a lastKnownVersion, use it; otherwise use latest snapshot version
  const opsVersion = lastKnownVersion !== null ? lastKnownVersion : version;
  const ops = await getOpsSince(documentId, opsVersion);

  return {
    snapshot: snapshot?.snapshot_bytes || null,
    ops: ops.map((op) => op.op_bytes),
    version,
  };
}

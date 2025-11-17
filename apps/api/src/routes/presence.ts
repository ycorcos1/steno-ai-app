import express, { Request, Response } from "express";
import { authenticateToken } from "../middleware/auth";
import { checkDocumentAccess, getUsersByIds } from "../db/pg";
import { getConnectionsByDocument } from "../realtime/connections";

const router = express.Router();

/**
 * GET /documents/:id/presence
 * Returns list of active collaborators for a document
 */
router.get(
  "/:id/presence",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { id: documentId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const access = await checkDocumentAccess(documentId, userId);
      if (!access) {
        return res.status(403).json({ error: "Access denied" });
      }

      const connections = await getConnectionsByDocument(documentId);
      const uniqueUserIds = Array.from(
        new Set(connections.map((conn) => conn.userId))
      );

      const users = await getUsersByIds(uniqueUserIds);
      const now = Date.now();

      const activeUsers = users.map((user) => ({
        userId: user.id,
        userName: user.name || user.email.split("@")[0],
        email: user.email,
        status: "online",
        joinedAt: now,
      }));

      return res.status(200).json({ activeUsers });
    } catch (error) {
      console.error("Failed to fetch presence:", error);
      return res.status(500).json({ error: "Failed to fetch presence" });
    }
  }
);

export default router;


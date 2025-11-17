import express, { Request, Response } from "express";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  declineInvitation,
  getDocumentCollaborators,
  getInvitationByToken,
  getInvitationsByDocument,
  getInvitationsByUser,
  Invitation,
  InvitationRole,
  removeCollaborator,
  resendInvitation,
  updateCollaboratorRole,
  checkDocumentAccess,
} from "../db/pg";
import { authenticateToken } from "../middleware/auth";
import { isValidInvitationToken } from "../lib/token";
import {
  disconnectUserConnections,
  getConnectionsByDocument,
  ConnectionRecord,
} from "../realtime/connections";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

const documentsRouter = express.Router();
const invitationsRouter = express.Router();

const ONE_HOUR_MS = 60 * 60 * 1000;
const DOC_RATE_LIMIT = 50; // per document per hour
const USER_RATE_LIMIT = 10; // per inviter per hour

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const documentRateMap = new Map<string, RateLimitEntry>();
const userRateMap = new Map<string, RateLimitEntry>();

function checkRateLimit(
  map: Map<string, RateLimitEntry>,
  key: string,
  limit: number
): boolean {
  const now = Date.now();
  const entry = map.get(key);

  if (!entry || now >= entry.resetAt) {
    map.set(key, { count: 1, resetAt: now + ONE_HOUR_MS });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count += 1;
  return true;
}

function validateEmail(email: string): boolean {
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email);
}

async function sendRoleChangedEvent(
  connections: ConnectionRecord[],
  newRole: InvitationRole
): Promise<void> {
  const region = process.env.REGION || "us-east-1";
  const clientCache = new Map<string, ApiGatewayManagementApiClient>();

  await Promise.all(
    connections.map(async (conn) => {
      try {
        let client = clientCache.get(conn.endpoint);
        if (!client) {
          client = new ApiGatewayManagementApiClient({
            region,
            endpoint: conn.endpoint,
          });
          clientCache.set(conn.endpoint, client);
        }

        await client.send(
          new PostToConnectionCommand({
            ConnectionId: conn.connectionId,
            Data: JSON.stringify({
              type: "role_changed",
              newRole,
            }),
          })
        );
      } catch (error) {
        console.warn(
          `Failed to send role_changed to ${conn.connectionId}:`,
          error
        );
      }
    })
  );
}

documentsRouter.post(
  "/:id/invitations",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { id: documentId } = req.params;
    const { email, role = "editor" } = req.body as {
      email?: string;
      role?: InvitationRole;
    };
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }

    if (!validateEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (role !== "editor" && role !== "viewer") {
      return res
        .status(400)
        .json({ error: "Role must be either 'editor' or 'viewer'" });
    }

    try {
      const access = await checkDocumentAccess(documentId, userId);
      if (access !== "owner") {
        return res
          .status(403)
          .json({ error: "Only the document owner can invite collaborators" });
      }

      const collaborators = await getDocumentCollaborators(documentId);
      const alreadyCollaborator = collaborators.some(
        (collab) =>
          collab.email.toLowerCase() === email.toLowerCase() &&
          collab.role !== "owner"
      );

      if (alreadyCollaborator) {
        return res
          .status(400)
          .json({ error: "User is already a collaborator on this document" });
      }

      const docLimitKey = `${documentId}:${new Date()
        .toISOString()
        .slice(0, 13)}`;
      const userLimitKey = `${userId}:${new Date()
        .toISOString()
        .slice(0, 13)}`;

      if (!checkRateLimit(documentRateMap, docLimitKey, DOC_RATE_LIMIT)) {
        return res.status(429).json({
          error: "RATE_LIMIT_EXCEEDED",
          message: "Invitation limit reached for this document. Try later.",
          retryAfter: 3600,
        });
      }

      if (!checkRateLimit(userRateMap, userLimitKey, USER_RATE_LIMIT)) {
        return res.status(429).json({
          error: "RATE_LIMIT_EXCEEDED",
          message: "Invitation limit reached for this user. Try later.",
          retryAfter: 3600,
        });
      }

      const invitation = await createInvitation(
        documentId,
        userId,
        email.trim(),
        role
      );

      return res.status(201).json({
        invitationId: invitation.id,
        token: invitation.token,
        expiresAt: invitation.expires_at,
        role: invitation.role,
        inviteeEmail: invitation.invitee_email,
      });
    } catch (error: any) {
      if (
        error.code === "23505" &&
        error.constraint === "unique_pending_invitation"
      ) {
        return res.status(400).json({
          error: "Pending invitation already exists for this email",
        });
      }

      console.error("Failed to create invitation:", error);
      return res.status(500).json({ error: "Failed to create invitation" });
    }
  }
);

invitationsRouter.get(
  "/",
  authenticateToken,
  async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const email = req.user?.email;

    if (!userId || !email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const invitations = await getInvitationsByUser(userId, email);
      return res.status(200).json({ invitations });
    } catch (error) {
      console.error("Failed to fetch invitations:", error);
      return res.status(500).json({ error: "Failed to fetch invitations" });
    }
  }
);

invitationsRouter.get(
  "/:token",
  async (req: Request, res: Response) => {
    const { token } = req.params;

    if (!isValidInvitationToken(token)) {
      return res
        .status(400)
        .json({ error: "Invalid invitation link", status: "invalid" });
    }

    try {
      const invitation = await getInvitationByToken(token);

      if (!invitation) {
        return res.status(404).json({
          error: "Invitation not found. The link may be invalid or expired.",
          status: "not_found",
        });
      }

      if (invitation.status !== "pending") {
        return res.status(410).json({
          error: `This invitation has already been ${invitation.status}.`,
          status: invitation.status,
        });
      }

      const isExpired = new Date() > invitation.expires_at;
      if (isExpired) {
        return res.status(410).json({
          error: "This invitation has expired. Please request a new invitation.",
          status: "expired",
        });
      }

      return res.status(200).json({
        documentId: invitation.document_id,
        documentTitle: invitation.document_title,
        inviterName: invitation.inviter_name,
        inviterEmail: invitation.inviter_email,
        role: invitation.role,
        expiresAt: invitation.expires_at,
        inviteeEmail: invitation.invitee_email,
      });
    } catch (error) {
      console.error("Failed to fetch invitation:", error);
      return res.status(500).json({ error: "Failed to fetch invitation" });
    }
  }
);

invitationsRouter.post(
  "/:token/accept",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { token } = req.params;
    const userId = req.user?.userId;
    const email = req.user?.email;

    if (!userId || !email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const invitation = await getInvitationByToken(token);
      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found" });
      }

      if (
        invitation.invitee_email.toLowerCase() !== email.toLowerCase() &&
        invitation.invitee_user_id !== userId
      ) {
        return res.status(403).json({
          error: `This invitation was sent to ${invitation.invitee_email}. Please log in with that email address.`,
        });
      }

      const result = await acceptInvitation(token, userId);
      return res.status(200).json({
        message: "Invitation accepted",
        documentId: result.documentId,
        role: result.role,
      });
    } catch (error: any) {
      const message = typeof error.message === "string" ? error.message : "";

      if (message === "INVITATION_NOT_FOUND") {
        return res.status(404).json({ error: "Invitation not found" });
      }

      if (message === "INVITATION_EXPIRED") {
        return res.status(410).json({
          error: "This invitation has expired. Please request a new invitation.",
        });
      }

      if (message.startsWith("INVITATION_")) {
        return res.status(410).json({
          error: `This invitation has already been ${message
            .split("_")[1]
            .toLowerCase()}.`,
        });
      }

      console.error("Failed to accept invitation:", error);
      return res.status(500).json({ error: "Failed to accept invitation" });
    }
  }
);

invitationsRouter.post(
  "/:token/decline",
  async (req: Request, res: Response) => {
    const { token } = req.params;

    try {
      await declineInvitation(token);
      return res.status(200).json({ message: "Invitation declined" });
    } catch (error) {
      console.error("Failed to decline invitation:", error);
      return res.status(500).json({ error: "Failed to decline invitation" });
    }
  }
);

documentsRouter.get(
  "/:id/collaborators",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { id: documentId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const access = await checkDocumentAccess(documentId, userId);
      if (access !== "owner") {
        return res
          .status(403)
          .json({ error: "Only the document owner can view collaborators" });
      }

      const collaborators = await getDocumentCollaborators(documentId);
      return res.status(200).json({ collaborators });
    } catch (error) {
      console.error("Failed to fetch collaborators:", error);
      return res.status(500).json({ error: "Failed to fetch collaborators" });
    }
  }
);

documentsRouter.get(
  "/:id/invitations",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { id: documentId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const access = await checkDocumentAccess(documentId, userId);
      if (access !== "owner") {
        return res
          .status(403)
          .json({ error: "Only the document owner can view invitations" });
      }

      const invitations = await getInvitationsByDocument(documentId);
      return res.status(200).json({ invitations });
    } catch (error) {
      console.error("Failed to fetch invitations:", error);
      return res.status(500).json({ error: "Failed to fetch invitations" });
    }
  }
);

documentsRouter.delete(
  "/:id/collaborators/:collaboratorId",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { id: documentId, collaboratorId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const access = await checkDocumentAccess(documentId, userId);
      if (access !== "owner") {
        return res
          .status(403)
          .json({ error: "Only the document owner can remove collaborators" });
      }

      const removed = await removeCollaborator(documentId, collaboratorId, userId);
      if (!removed) {
        return res
          .status(404)
          .json({ error: "Collaborator not found on this document" });
      }

      await disconnectUserConnections(collaboratorId, documentId);

      return res.status(200).json({ message: "Collaborator removed" });
    } catch (error) {
      console.error("Failed to remove collaborator:", error);
      return res.status(500).json({ error: "Failed to remove collaborator" });
    }
  }
);

documentsRouter.patch(
  "/:id/collaborators/:collaboratorId",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { id: documentId, collaboratorId } = req.params;
    const { role } = req.body as { role?: InvitationRole };
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (role !== "editor" && role !== "viewer") {
      return res
        .status(400)
        .json({ error: "Role must be either 'editor' or 'viewer'" });
    }

    try {
      const access = await checkDocumentAccess(documentId, userId);
      if (access !== "owner") {
        return res
          .status(403)
          .json({ error: "Only the document owner can change roles" });
      }

      const updated = await updateCollaboratorRole(
        documentId,
        collaboratorId,
        role,
        userId
      );

      if (!updated) {
        return res
          .status(404)
          .json({ error: "Collaborator not found on this document" });
      }

      const documentConnections = await getConnectionsByDocument(documentId);
      const userConnections = documentConnections.filter(
        (conn) => conn.userId === collaboratorId
      );

      if (userConnections.length > 0) {
        await sendRoleChangedEvent(userConnections, role);

        if (role === "viewer") {
          await disconnectUserConnections(collaboratorId, documentId);
        }
      }

      return res
        .status(200)
        .json({ message: "Collaborator role updated", role });
    } catch (error) {
      console.error("Failed to update collaborator role:", error);
      return res
        .status(500)
        .json({ error: "Failed to update collaborator role" });
    }
  }
);

documentsRouter.post(
  "/:id/invitations/:invitationId/resend",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { id: documentId, invitationId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const access = await checkDocumentAccess(documentId, userId);
      if (access !== "owner") {
        return res
          .status(403)
          .json({ error: "Only the document owner can resend invitations" });
      }

      const invitation = await resendInvitation(invitationId, documentId, userId);
      if (!invitation) {
        return res
          .status(404)
          .json({ error: "Invitation not found or cannot be resent" });
      }

      return res.status(200).json({
        message: "Invitation resent",
        token: invitation.token,
        expiresAt: invitation.expires_at,
      });
    } catch (error) {
      console.error("Failed to resend invitation:", error);
      return res.status(500).json({ error: "Failed to resend invitation" });
    }
  }
);

documentsRouter.post(
  "/:id/invitations/:invitationId/cancel",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { id: documentId, invitationId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const access = await checkDocumentAccess(documentId, userId);
      if (access !== "owner") {
        return res
          .status(403)
          .json({ error: "Only the document owner can cancel invitations" });
      }

      const cancelled = await cancelInvitation(invitationId, documentId, userId);
      if (!cancelled) {
        return res
          .status(404)
          .json({ error: "Invitation not found or already finalized" });
      }

      return res.status(200).json({ message: "Invitation cancelled" });
    } catch (error) {
      console.error("Failed to cancel invitation:", error);
      return res.status(500).json({ error: "Failed to cancel invitation" });
    }
  }
);

export { documentsRouter, invitationsRouter };


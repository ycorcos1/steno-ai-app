import axios from "axios";
import { authApi } from "./auth";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

const publicApi = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

export type InvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "expired"
  | "cancelled";

export type InvitationRole = "editor" | "viewer";

export interface Invitation {
  id: string;
  documentId: string;
  documentTitle?: string;
  inviterName?: string;
  inviterEmail?: string;
  inviteeEmail: string;
  role: InvitationRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt?: string;
  token?: string;
}

export interface Collaborator {
  userId: string;
  userName: string;
  email: string;
  role: "owner" | InvitationRole;
  isOwner: boolean;
}

const mapInvitation = (raw: any): Invitation => ({
  id: raw.id,
  documentId: raw.document_id ?? raw.documentId ?? "",
  documentTitle: raw.document_title ?? raw.documentTitle,
  inviterName: raw.inviter_name ?? raw.inviterName,
  inviterEmail: raw.inviter_email ?? raw.inviterEmail,
  inviteeEmail: raw.invitee_email ?? raw.inviteeEmail ?? "",
  role: (raw.role ?? "editor") as InvitationRole,
  status: (raw.status ?? "pending") as InvitationStatus,
  expiresAt: raw.expires_at ?? raw.expiresAt ?? "",
  createdAt: raw.created_at ?? raw.createdAt,
  token: raw.token,
});

/**
 * Create a new invitation for a document.
 */
export async function createInvitation(
  documentId: string,
  email: string,
  role: InvitationRole
): Promise<{ invitationId: string; token: string; expiresAt: string }> {
  const response = await authApi.post(`/documents/${documentId}/invitations`, {
    email,
    role,
  });
  return response.data;
}

/**
 * Fetch all pending invitations for the current user.
 */
export async function getInvitations(): Promise<Invitation[]> {
  const response = await authApi.get("/invitations");
  const invitations = (response.data?.invitations ?? []) as any[];
  return invitations.map(mapInvitation);
}

/**
 * Fetch invitations for a specific document (owner only).
 */
export async function getInvitationsByDocument(
  documentId: string
): Promise<Invitation[]> {
  const response = await authApi.get(`/documents/${documentId}/invitations`);
  const invitations = (response.data?.invitations ?? []) as any[];
  return invitations.map(mapInvitation);
}

/**
 * Fetch invitation details by token (public).
 */
export async function getInvitationByToken(token: string): Promise<Invitation> {
  const response = await publicApi.get(`/invitations/${token}`);
  return {
    id: token,
    documentId: response.data.documentId,
    documentTitle: response.data.documentTitle,
    inviterName: response.data.inviterName,
    inviterEmail: response.data.inviterEmail,
    inviteeEmail: response.data.inviteeEmail,
    role: response.data.role,
    status: "pending",
    expiresAt: response.data.expiresAt,
  };
}

/**
 * Accept an invitation.
 */
export async function acceptInvitation(
  token: string
): Promise<{ documentId: string; role: InvitationRole }> {
  const response = await authApi.post(`/invitations/${token}/accept`);
  return response.data;
}

/**
 * Decline an invitation.
 */
export async function declineInvitation(token: string): Promise<void> {
  await publicApi.post(`/invitations/${token}/decline`);
}

/**
 * Fetch collaborators for a document (owner only).
 */
export async function getCollaborators(
  documentId: string
): Promise<Collaborator[]> {
  const response = await authApi.get(`/documents/${documentId}/collaborators`);
  return response.data?.collaborators ?? [];
}

/**
 * Remove a collaborator from a document.
 */
export async function removeCollaborator(
  documentId: string,
  userId: string
): Promise<void> {
  await authApi.delete(`/documents/${documentId}/collaborators/${userId}`);
}

/**
 * Update collaborator role.
 */
export async function updateCollaboratorRole(
  documentId: string,
  userId: string,
  role: InvitationRole
): Promise<void> {
  await authApi.patch(`/documents/${documentId}/collaborators/${userId}`, {
    role,
  });
}

/**
 * Resend an invitation (owner only).
 */
export async function resendInvitation(
  documentId: string,
  invitationId: string
): Promise<{ token: string; expiresAt: string }> {
  const response = await authApi.post(
    `/documents/${documentId}/invitations/${invitationId}/resend`
  );
  return {
    token: response.data.token,
    expiresAt: response.data.expiresAt,
  };
}

/**
 * Cancel an invitation (owner only).
 */
export async function cancelInvitation(
  documentId: string,
  invitationId: string
): Promise<void> {
  await authApi.post(
    `/documents/${documentId}/invitations/${invitationId}/cancel`
  );
}


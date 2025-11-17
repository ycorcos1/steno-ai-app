-- 0007_invitations.sql
-- Creates invitations table and supporting indexes for collaboration invites

BEGIN;

CREATE TABLE IF NOT EXISTS invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    inviter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_email VARCHAR(255) NOT NULL,
    invitee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'editor',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP,
    declined_at TIMESTAMP,
    cancelled_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invitations_invitee_email
    ON invitations(invitee_email);

CREATE INDEX IF NOT EXISTS idx_invitations_invitee_user_id
    ON invitations(invitee_user_id);

CREATE INDEX IF NOT EXISTS idx_invitations_token
    ON invitations(token);

CREATE INDEX IF NOT EXISTS idx_invitations_status
    ON invitations(status);

CREATE INDEX IF NOT EXISTS idx_invitations_document_id
    ON invitations(document_id);

-- Create unique partial index for pending invitations
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_unique_pending
    ON invitations(document_id, invitee_email)
    WHERE status = 'pending';

COMMIT;


-- StenoAI Initial Schema Migration
-- Creates all core tables for user management, documents, templates, collaboration, and exports
-- Migration: 0001_init.sql
-- Applied: Automatically tracked by schema_migrations table

BEGIN;

-- ============================================================================
-- USERS TABLE
-- ============================================================================
-- Stores user authentication and profile information
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE users IS 'User accounts for authentication and authorization';
COMMENT ON COLUMN users.id IS 'Unique user identifier (UUID)';
COMMENT ON COLUMN users.email IS 'User email address (unique, used for login)';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt/Argon2 hashed password';
COMMENT ON COLUMN users.created_at IS 'Account creation timestamp';

-- ============================================================================
-- TEMPLATES TABLE
-- ============================================================================
-- Stores document templates (personal and global/firm-wide)
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  is_global BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE
);

COMMENT ON TABLE templates IS 'Document templates for AI draft generation';
COMMENT ON COLUMN templates.id IS 'Unique template identifier (UUID)';
COMMENT ON COLUMN templates.title IS 'Template display name';
COMMENT ON COLUMN templates.content IS 'Template body text (used in prompt composition)';
COMMENT ON COLUMN templates.is_global IS 'If true, template is available to all users (firm-wide)';
COMMENT ON COLUMN templates.owner_id IS 'User who created this template (NULL if global)';

-- ============================================================================
-- DOCUMENTS TABLE
-- ============================================================================
-- Stores uploaded documents, extracted text, and generated drafts
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key VARCHAR(512) NOT NULL,
  title VARCHAR(255) NOT NULL,
  extracted_text TEXT,
  draft_text TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'uploaded',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE documents IS 'User-uploaded documents and AI-generated drafts';
COMMENT ON COLUMN documents.id IS 'Unique document identifier (UUID)';
COMMENT ON COLUMN documents.owner_id IS 'User who owns this document';
COMMENT ON COLUMN documents.key IS 'S3 object key for the original uploaded file';
COMMENT ON COLUMN documents.title IS 'Document display name';
COMMENT ON COLUMN documents.extracted_text IS 'Text extracted from uploaded file (PDF/DOCX)';
COMMENT ON COLUMN documents.draft_text IS 'AI-generated or manually edited draft content';
COMMENT ON COLUMN documents.status IS 'Document lifecycle status: uploaded|extracted|draft_generated|exported';

-- ============================================================================
-- REFINEMENTS TABLE
-- ============================================================================
-- Stores AI refinement history for documents
CREATE TABLE refinements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE refinements IS 'History of AI refinement operations on documents';
COMMENT ON COLUMN refinements.id IS 'Unique refinement identifier (UUID)';
COMMENT ON COLUMN refinements.document_id IS 'Document being refined';
COMMENT ON COLUMN refinements.prompt IS 'User-provided refinement instruction';
COMMENT ON COLUMN refinements.result IS 'AI-generated refined text';
COMMENT ON COLUMN refinements.created_at IS 'When this refinement was created';

-- ============================================================================
-- DOC_CHUNKS TABLE
-- ============================================================================
-- Stores chunk metadata for large documents processed in segments
CREATE TABLE doc_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  start INTEGER NOT NULL,
  "end" INTEGER NOT NULL,
  summary TEXT,
  UNIQUE(document_id, idx)
);

COMMENT ON TABLE doc_chunks IS 'Chunk metadata for large documents processed in segments';
COMMENT ON COLUMN doc_chunks.id IS 'Unique chunk identifier (UUID)';
COMMENT ON COLUMN doc_chunks.document_id IS 'Parent document';
COMMENT ON COLUMN doc_chunks.idx IS 'Chunk sequence number (0-indexed)';
COMMENT ON COLUMN doc_chunks.start IS 'Start character position in extracted_text';
COMMENT ON COLUMN doc_chunks."end" IS 'End character position in extracted_text';
COMMENT ON COLUMN doc_chunks.summary IS 'Optional summary of chunk content';

-- ============================================================================
-- DOC_SNAPSHOTS TABLE
-- ============================================================================
-- Stores periodic Y.js CRDT snapshots for collaborative editing
CREATE TABLE doc_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot_bytes BYTEA NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, version)
);

COMMENT ON TABLE doc_snapshots IS 'Periodic Y.js CRDT snapshots for collaborative document editing';
COMMENT ON COLUMN doc_snapshots.id IS 'Unique snapshot identifier (UUID)';
COMMENT ON COLUMN doc_snapshots.document_id IS 'Document this snapshot belongs to';
COMMENT ON COLUMN doc_snapshots.version IS 'Snapshot version number (incremental)';
COMMENT ON COLUMN doc_snapshots.snapshot_bytes IS 'Y.js encoded document state (binary)';
COMMENT ON COLUMN doc_snapshots.created_at IS 'When this snapshot was created';

-- ============================================================================
-- DOC_OPS TABLE
-- ============================================================================
-- Stores incremental Y.js operations for collaborative editing
CREATE TABLE doc_ops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  op_bytes BYTEA NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  session_id VARCHAR(255)
);

COMMENT ON TABLE doc_ops IS 'Incremental Y.js operations for collaborative document editing';
COMMENT ON COLUMN doc_ops.id IS 'Unique operation identifier (UUID)';
COMMENT ON COLUMN doc_ops.document_id IS 'Document this operation applies to';
COMMENT ON COLUMN doc_ops.op_bytes IS 'Y.js operation binary data';
COMMENT ON COLUMN doc_ops.created_at IS 'When this operation was created';
COMMENT ON COLUMN doc_ops.session_id IS 'WebSocket session/connection identifier';

-- ============================================================================
-- USER_PROMPTS TABLE
-- ============================================================================
-- Stores user-defined reusable AI prompts
CREATE TABLE user_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE user_prompts IS 'User-defined reusable AI prompt templates';
COMMENT ON COLUMN user_prompts.id IS 'Unique prompt identifier (UUID)';
COMMENT ON COLUMN user_prompts.owner_id IS 'User who created this prompt';
COMMENT ON COLUMN user_prompts.name IS 'Prompt display name';
COMMENT ON COLUMN user_prompts.body IS 'Prompt text body';

-- ============================================================================
-- DOCUMENT_COLLABORATORS TABLE
-- ============================================================================
-- Stores document sharing and collaboration permissions
CREATE TABLE document_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(document_id, user_id)
);

COMMENT ON TABLE document_collaborators IS 'Document sharing and collaboration permissions';
COMMENT ON COLUMN document_collaborators.id IS 'Unique collaborator record identifier (UUID)';
COMMENT ON COLUMN document_collaborators.document_id IS 'Document being shared';
COMMENT ON COLUMN document_collaborators.user_id IS 'User with access to document';
COMMENT ON COLUMN document_collaborators.role IS 'Access role: owner|editor|viewer';
COMMENT ON COLUMN document_collaborators.added_at IS 'When user was granted access';

-- ============================================================================
-- EXPORTS TABLE
-- ============================================================================
-- Stores metadata for exported Word documents
CREATE TABLE exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  s3_key VARCHAR(512) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);

COMMENT ON TABLE exports IS 'Metadata for exported Word documents';
COMMENT ON COLUMN exports.id IS 'Unique export identifier (UUID)';
COMMENT ON COLUMN exports.document_id IS 'Source document that was exported';
COMMENT ON COLUMN exports.s3_key IS 'S3 object key for the exported .docx file';
COMMENT ON COLUMN exports.created_at IS 'When export was created';
COMMENT ON COLUMN exports.expires_at IS 'When export download link expires (S3 lifecycle)';

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Templates indexes
CREATE INDEX idx_templates_owner ON templates(owner_id);
CREATE INDEX idx_templates_global ON templates(is_global) WHERE is_global = true;

-- Documents indexes
CREATE INDEX idx_documents_owner ON documents(owner_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE INDEX idx_documents_created ON documents(owner_id, created_at DESC);

-- Refinements indexes
CREATE INDEX idx_refinements_document ON refinements(document_id);
CREATE INDEX idx_refinements_created ON refinements(document_id, created_at DESC);

-- Doc chunks indexes
CREATE INDEX idx_doc_chunks_document ON doc_chunks(document_id);
CREATE INDEX idx_doc_chunks_sequence ON doc_chunks(document_id, idx);

-- Doc snapshots indexes
CREATE INDEX idx_doc_snapshots_document ON doc_snapshots(document_id);
CREATE INDEX idx_doc_snapshots_version ON doc_snapshots(document_id, version DESC);

-- Doc ops indexes
CREATE INDEX idx_doc_ops_document ON doc_ops(document_id);
CREATE INDEX idx_doc_ops_created ON doc_ops(document_id, created_at ASC);
CREATE INDEX idx_doc_ops_session ON doc_ops(session_id) WHERE session_id IS NOT NULL;

-- User prompts indexes
CREATE INDEX idx_user_prompts_owner ON user_prompts(owner_id);

-- Document collaborators indexes
CREATE INDEX idx_document_collaborators_document ON document_collaborators(document_id);
CREATE INDEX idx_document_collaborators_user ON document_collaborators(user_id);
CREATE INDEX idx_document_collaborators_role ON document_collaborators(document_id, role);

-- Exports indexes
CREATE INDEX idx_exports_document ON exports(document_id);
CREATE INDEX idx_exports_expires ON exports(expires_at);
CREATE INDEX idx_exports_created ON exports(document_id, created_at DESC);

COMMIT;


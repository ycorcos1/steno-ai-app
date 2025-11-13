-- StenoAI Collaboration Migration
-- Migration: 0003_collab.sql
-- Ensures collaboration tables and indexes are properly set up for Y.js WebSocket collaboration

BEGIN;

-- ============================================================================
-- DOC_SNAPSHOTS TABLE
-- ============================================================================
-- Stores periodic Y.js CRDT snapshots for collaborative editing
-- Note: If tables already exist from 0001_init.sql, these CREATE IF NOT EXISTS
-- statements will be no-ops, but we ensure indexes are optimal

-- Ensure doc_snapshots table exists (idempotent)
CREATE TABLE IF NOT EXISTS doc_snapshots (
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
CREATE TABLE IF NOT EXISTS doc_ops (
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
-- INDEXES FOR PERFORMANCE
-- ============================================================================
-- Ensure indexes exist (CREATE INDEX IF NOT EXISTS is not supported in all PostgreSQL versions,
-- so we use DO block to check and create conditionally)

DO $$
BEGIN
  -- Doc snapshots indexes
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_doc_snapshots_document') THEN
    CREATE INDEX idx_doc_snapshots_document ON doc_snapshots(document_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_doc_snapshots_version') THEN
    CREATE INDEX idx_doc_snapshots_version ON doc_snapshots(document_id, version DESC);
  END IF;

  -- Doc ops indexes
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_doc_ops_document') THEN
    CREATE INDEX idx_doc_ops_document ON doc_ops(document_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_doc_ops_created') THEN
    CREATE INDEX idx_doc_ops_created ON doc_ops(document_id, created_at ASC);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_doc_ops_session') THEN
    CREATE INDEX idx_doc_ops_session ON doc_ops(session_id) WHERE session_id IS NOT NULL;
  END IF;
END $$;

COMMIT;


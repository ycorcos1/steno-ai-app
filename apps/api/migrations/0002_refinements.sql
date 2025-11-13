-- StenoAI Refinements Migration
-- Migration: 0002_refinements.sql
-- Note: The refinements table was already created in 0001_init.sql
-- This migration ensures the table exists and is properly indexed (idempotent)

BEGIN;

-- ============================================================================
-- REFINEMENTS TABLE
-- ============================================================================
-- Stores AI refinement history for documents
-- Note: This table was created in 0001_init.sql, but we ensure it exists here
-- for migration consistency

CREATE TABLE IF NOT EXISTS refinements (
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
-- INDEXES FOR PERFORMANCE
-- ============================================================================
-- Ensure indexes exist (idempotent)

DO $$
BEGIN
  -- Refinements indexes
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_refinements_document') THEN
    CREATE INDEX idx_refinements_document ON refinements(document_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_refinements_created') THEN
    CREATE INDEX idx_refinements_created ON refinements(document_id, created_at DESC);
  END IF;
END $$;

COMMIT;


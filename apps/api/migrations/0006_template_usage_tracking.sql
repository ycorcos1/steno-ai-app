-- Add last_used_at column to templates table for tracking template usage
-- Migration: 0006_template_usage_tracking.sql

BEGIN;

ALTER TABLE templates
ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;

COMMENT ON COLUMN templates.last_used_at IS 'Timestamp when template was last used for draft generation';

COMMIT;


-- ============================================================================
-- 0004_user_prompts.sql
-- ============================================================================
-- NOTE: user_prompts table already created in 0001_init.sql
-- This migration adds performance indexes and validation

-- Add index for faster lookups by owner and name
CREATE INDEX IF NOT EXISTS idx_user_prompts_name ON user_prompts(owner_id, name);

-- Add constraint to ensure name is not empty
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_user_prompts_name_not_empty'
  ) THEN
    ALTER TABLE user_prompts ADD CONSTRAINT chk_user_prompts_name_not_empty 
      CHECK (length(trim(name)) > 0);
  END IF;
END $$;

-- Add constraint to ensure body is not empty  
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'chk_user_prompts_body_not_empty'
  ) THEN
    ALTER TABLE user_prompts ADD CONSTRAINT chk_user_prompts_body_not_empty 
      CHECK (length(trim(body)) > 0);
  END IF;
END $$;

COMMENT ON INDEX idx_user_prompts_name IS 'Speeds up prompt lookups by owner and name';


-- Add Gemini Files API tracking to files table
ALTER TABLE files ADD COLUMN gemini_uri TEXT;
ALTER TABLE files ADD COLUMN gemini_uploaded_at INTEGER;

-- Index for finding expired Gemini files
CREATE INDEX IF NOT EXISTS idx_gemini_uploaded ON files(gemini_uploaded_at);

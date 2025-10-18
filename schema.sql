-- File metadata table
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  content_type TEXT,
  uploaded_at INTEGER NOT NULL,
  tags TEXT, -- JSON array of tags
  summary TEXT, -- Optional AI-generated summary
  gemini_uri TEXT, -- Gemini Files API URI for .docx files
  gemini_uploaded_at INTEGER -- Timestamp when uploaded to Gemini (for expiry tracking)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_filename ON files(filename);
CREATE INDEX IF NOT EXISTS idx_uploaded ON files(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_type ON files(content_type);
CREATE INDEX IF NOT EXISTS idx_gemini_uploaded ON files(gemini_uploaded_at);

-- Query log table (optional, for debugging)
CREATE TABLE IF NOT EXISTS query_log (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  files_accessed TEXT, -- JSON array of file IDs
  tools_used TEXT, -- JSON array of tools
  response_time INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_query_created ON query_log(created_at DESC);

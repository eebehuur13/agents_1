# Gemini Files API Support Setup

This guide explains how to enable multi-format file reading in your document assistant using Gemini Files API.

## Supported File Formats

Gemini Files API can natively read and analyze:

**Documents:** PDF, DOCX, DOC, HTML  
**Spreadsheets:** XLSX, CSV  
**Presentations:** PPTX  
**Images:** JPG, PNG, GIF, WEBP, SVG  
**Audio:** MP3, WAV, FLAC, AAC  
**Video:** MP4, MOV, AVI, MPEG, WebM, WMV, 3GPP, FLV  
**Archives:** ZIP, TAR

Plain text files (.txt, .json, .md) are read directly without Gemini.

## How It Works

**Option B Strategy - On-Demand Upload:**
1. User uploads any supported file → stored only in R2
2. When AI needs to read it → upload to Gemini Files API automatically
3. Gemini URI cached in database
4. On next read → check if URI still works, if not → re-upload
5. When user deletes file → deleted from both R2 and Gemini

## Setup Steps

### 1. Install Required Package

```bash
cd doc-assistant
npm install @google/generative-ai@latest
```

### 2. Run Database Migration

If you have an **existing database**, run the migration to add new columns:

```bash
# For local development
wrangler d1 execute doc-assistant-db --local --file=./migrations/0001_add_gemini_fields.sql

# For production
wrangler d1 execute doc-assistant-db --file=./migrations/0001_add_gemini_fields.sql
```

If this is a **fresh setup**, just run:

```bash
# Local
wrangler d1 execute doc-assistant-db --local --file=./schema.sql

# Production
wrangler d1 execute doc-assistant-db --file=./schema.sql
```

### 3. Deploy

```bash
wrangler deploy
```

## What Changed

### Database
- Added `gemini_uri` column - stores Gemini Files API reference
- Added `gemini_uploaded_at` column - tracks upload time for expiry

### Code Logic

**tools.ts:**
- `shouldUseGeminiFilesAPI()` - determines which files need Gemini (vs plain text)
- `getMimeType()` - determines correct MIME type for uploads
- `uploadToGemini()` - uploads files to Gemini Files API with correct MIME type
- `deleteFromGemini()` - deletes from Gemini when user deletes file
- `checkGeminiFile()` - tries to access the URI to see if it still works
- `readFile()` updated - handles all supported file formats via Gemini

**index.ts:**
- Delete endpoint updated - also deletes from Gemini

**gemini.ts:**
- System prompt updated - tells AI how to handle gemini_uri

## Testing

Upload different file types:
```bash
# Word document
curl -F "file=@test.docx" http://localhost:8787/api/upload

# PDF
curl -F "file=@report.pdf" http://localhost:8787/api/upload

# Excel spreadsheet
curl -F "file=@data.xlsx" http://localhost:8787/api/upload

# Image
curl -F "file=@chart.png" http://localhost:8787/api/upload
```

Ask the AI to read them:
```bash
curl -X POST http://localhost:8787/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Summarize test.docx"}'

curl -X POST http://localhost:8787/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What data is in data.xlsx?"}'

curl -X POST http://localhost:8787/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "Describe what you see in chart.png"}'
```

## Expected Behavior

### First Read (no cache):
1. AI calls `read_file` for any supported file (PDF, DOCX, image, etc.)
2. No cached URI exists
3. System uploads to Gemini (takes 1-3 seconds depending on file size)
4. Returns gemini_uri to AI
5. Saves URI in database
6. AI analyzes file

### Subsequent Reads (cached & valid):
1. AI calls `read_file` for the same file
2. System finds cached URI in database
3. Checks if URI still works (quick API call)
4. URI works → returns it immediately (fast!)
5. AI analyzes file

### Cached but Expired:
1. AI calls `read_file` for previously cached file
2. System finds cached URI in database
3. Checks if URI still works
4. URI fails → re-uploads to Gemini
5. Updates database with new URI
6. AI analyzes file

## Gemini Files API Limits

- **File Size:** Up to 5 GB per file, 50 GB total project storage
- **Files per prompt:** Up to 3,000 files
- **Retention:** 48 hours (we check on-demand if still valid)
- **Cost:** FREE (included in Gemini API usage)
- **Formats:** All listed formats supported natively

## Troubleshooting

**Error: "Failed to process file with Gemini"**
- Check if file format is supported (see list above)
- Verify GEMINI_API_KEY is set
- Check file size < 5 GB
- Check file is not corrupted

**Error: "Gemini URI expired"**
- This is normal after 48 hours
- System will auto re-upload on next read
- No action needed

**File not deleting from Gemini:**
- Check logs for deletion errors
- Non-critical - Gemini auto-deletes after 48 hours anyway

**Plain text files not working:**
- .txt, .json, .md files bypass Gemini and read directly
- These should return text content, not gemini_uri
- If not working, check content_type detection

## Cost Analysis

**Per file read:**
- First read: 1-3 seconds for upload (FREE)
- Cached reads: ~200ms for validation check (FREE)
- Storage: FREE (Gemini handles it)
- 48-hour retention: FREE

**vs Parsing Locally:**
- Would need multiple libraries (mammoth, pdf-parse, xlsx, etc.)
- Larger bundle sizes
- Potential formatting issues
- More code to maintain
- Different parsers for each format

**Winner: Gemini Files API** ✓ 
- Single unified API
- Perfect accuracy
- No dependencies
- No maintenance

## Clean Up Old Gemini Files (Optional)

If you want to manually clean up expired Gemini URIs from your database:

```sql
-- Find expired entries
SELECT id, filename, gemini_uri, gemini_uploaded_at 
FROM files 
WHERE gemini_uri IS NOT NULL 
  AND gemini_uploaded_at < (strftime('%s', 'now') - 172800) * 1000;

-- Clear expired URIs (Gemini already deleted them)
UPDATE files 
SET gemini_uri = NULL, gemini_uploaded_at = NULL
WHERE gemini_uri IS NOT NULL 
  AND gemini_uploaded_at < (strftime('%s', 'now') - 172800) * 1000;
```

## Future Enhancements

Potential improvements:
- Background job to pre-upload frequently accessed files
- Analytics on Gemini API usage
- Smart caching based on access patterns
- Batch upload for multiple files
- Webhook notifications when files expire

## Questions?

The logic is solid and handles:
- ✓ On-demand upload (no wasted uploads)
- ✓ Caching (fast subsequent reads)
- ✓ Expiry handling (auto re-upload)
- ✓ Cleanup (deletes from both places)
- ✓ Error handling (graceful failures)

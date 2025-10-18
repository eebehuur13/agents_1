# Quick Start Guide

Get your document assistant running in 5 minutes!

## 1. Prerequisites

- Node.js 18+ installed
- Cloudflare account (free tier)
- Google AI API key from: https://aistudio.google.com/apikey

## 2. Install & Setup

```bash
# Install Wrangler globally
npm install -g wrangler

# Navigate to project
cd /Users/harishadithya/tools/doc-assistant

# Install dependencies
npm install

# Login to Cloudflare
wrangler login
```

## 3. Create Infrastructure

```bash
# Create R2 bucket for file storage
wrangler r2 bucket create doc-assistant-files

# Create D1 database for metadata
wrangler d1 create doc-assistant-db
```

**Copy the database_id from output and update `wrangler.toml`:**

```toml
[[d1_databases]]
binding = "DB"
database_name = "doc-assistant-db"
database_id = "PASTE_DATABASE_ID_HERE"
```

## 4. Initialize Database

```bash
wrangler d1 execute doc-assistant-db --file=schema.sql
```

## 5. Set API Key

```bash
wrangler secret put GEMINI_API_KEY
# Paste your Google AI API key when prompted
```

## 6. Deploy

```bash
npm run deploy
```

You'll get a URL like: `https://doc-assistant.YOUR-SUBDOMAIN.workers.dev`

## 7. Test It!

1. Open the URL in your browser
2. Upload a document (PDF, text file, etc.)
3. Ask a question: "What's in this document?"
4. Watch the AI think and answer!

---

## Local Development (Optional)

```bash
# Create local env file
echo "GEMINI_API_KEY=your-key" > .dev.vars

# Setup local database
npx wrangler d1 execute doc-assistant-db --local --file=schema.sql

# Start dev server
npm run dev

# Open http://localhost:8787
```

---

## Example Queries to Try

Once you've uploaded some files:

- "What files do I have?"
- "Summarize the project plan"
- "What's the budget for Q4?"
- "Find all mentions of 'deadline' in meeting notes"
- "Compare the timeline across all documents"

---

## Need Help?

1. Check `README.md` for full documentation
2. Check `DEPLOY.md` for detailed deployment guide
3. Run `wrangler tail` to view logs

---

**That's it! You now have an intelligent document assistant powered by AI! 🎉**

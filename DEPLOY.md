# Deployment Guide

## Quick Deploy (5 Minutes)

### Prerequisites Checklist

- [ ] Node.js 18+ installed (`node --version`)
- [ ] Cloudflare account created (free tier is fine)
- [ ] Google AI API key obtained from https://aistudio.google.com/apikey

### Step-by-Step Deployment

#### 1. Install Wrangler

```bash
npm install -g wrangler
```

#### 2. Login to Cloudflare

```bash
wrangler login
```

This opens a browser to authorize Wrangler.

#### 3. Navigate to Project

```bash
cd /Users/harishadithya/tools/doc-assistant
```

#### 4. Install Dependencies

```bash
npm install
```

#### 5. Create R2 Bucket

```bash
wrangler r2 bucket create doc-assistant-files
```

**Output:**
```
Created bucket doc-assistant-files
```

#### 6. Create D1 Database

```bash
wrangler d1 create doc-assistant-db
```

**Output:**
```
✅ Successfully created DB 'doc-assistant-db'

[[d1_databases]]
binding = "DB"
database_name = "doc-assistant-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**IMPORTANT:** Copy the `database_id` from the output!

#### 7. Update wrangler.toml

Open `wrangler.toml` and paste your database_id:

```toml
[[d1_databases]]
binding = "DB"
database_name = "doc-assistant-db"
database_id = "PASTE_YOUR_DATABASE_ID_HERE"
```

#### 8. Initialize Database Schema

```bash
wrangler d1 execute doc-assistant-db --file=schema.sql
```

**Output:**
```
🌀 Executing on doc-assistant-db:
🌀 To execute on your local DB, pass --local
✅ Executed 6 commands in 0.5s
```

#### 9. Set Gemini API Key

```bash
wrangler secret put GEMINI_API_KEY
```

**Prompt:**
```
Enter a secret value: [paste your API key here]
```

The key will be encrypted and stored securely.

#### 10. Deploy!

```bash
npm run deploy
```

**Output:**
```
⛅️ wrangler 3.89.0
------------------
Total Upload: xx.xx KiB / gzip: xx.xx KiB
Uploaded doc-assistant (x.xx sec)
Published doc-assistant (x.xx sec)
  https://doc-assistant.YOUR-SUBDOMAIN.workers.dev
Current Deployment ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**🎉 Deployment Complete!**

Visit: `https://doc-assistant.YOUR-SUBDOMAIN.workers.dev`

---

## Local Development Setup

For testing locally before deploying:

### 1. Create .dev.vars File

```bash
echo "GEMINI_API_KEY=your-gemini-api-key-here" > .dev.vars
```

**Note:** Never commit this file! It's in `.gitignore`.

### 2. Initialize Local Database

```bash
npx wrangler d1 execute doc-assistant-db --local --file=schema.sql
```

### 3. Start Dev Server

```bash
npm run dev
```

**Output:**
```
⛅️ wrangler 3.89.0
------------------
⎔ Starting local server...
[wrangler:inf] Ready on http://localhost:8787
```

### 4. Test Locally

Open: http://localhost:8787

Upload files and ask questions!

---

## Verification Steps

### 1. Test Health Endpoint

```bash
curl https://doc-assistant.YOUR-SUBDOMAIN.workers.dev/health
```

**Expected:**
```json
{"status":"ok","timestamp":1729468800000}
```

### 2. Check R2 Bucket

```bash
wrangler r2 bucket list
```

**Expected:**
```
doc-assistant-files
```

### 3. Check D1 Database

```bash
wrangler d1 execute doc-assistant-db --command="SELECT COUNT(*) FROM files"
```

**Expected:**
```
┌──────────┐
│ COUNT(*) │
├──────────┤
│ 0        │
└──────────┘
```

### 4. List Secrets

```bash
wrangler secret list
```

**Expected:**
```
{
  "GEMINI_API_KEY": "••••••••"
}
```

### 5. Test File Upload

```bash
curl -X POST https://doc-assistant.YOUR-SUBDOMAIN.workers.dev/api/upload \
  -F "file=@test.txt"
```

**Expected:**
```json
{
  "success": true,
  "file": {
    "id": "...",
    "filename": "test.txt",
    "size": 123,
    ...
  }
}
```

### 6. Test Query

```bash
curl -X POST https://doc-assistant.YOUR-SUBDOMAIN.workers.dev/api/query \
  -H "Content-Type: application/json" \
  -d '{"query":"What files do I have?"}'
```

**Expected:** Stream of SSE events showing AI thinking and responding.

---

## Updating After Changes

### 1. Pull Latest Changes

```bash
cd /Users/harishadithya/tools/doc-assistant
git pull # if using git
```

### 2. Install New Dependencies

```bash
npm install
```

### 3. Run New Migrations (if any)

```bash
wrangler d1 execute doc-assistant-db --file=migrations/001_add_tags.sql
```

### 4. Deploy

```bash
npm run deploy
```

---

## Managing Secrets

### Update API Key

```bash
wrangler secret put GEMINI_API_KEY
```

### Delete Secret

```bash
wrangler secret delete GEMINI_API_KEY
```

### List All Secrets

```bash
wrangler secret list
```

---

## Managing Database

### Run SQL Query

```bash
wrangler d1 execute doc-assistant-db --command="SELECT * FROM files LIMIT 5"
```

### Export Data

```bash
wrangler d1 export doc-assistant-db --output=backup.sql
```

### Import Data

```bash
wrangler d1 execute doc-assistant-db --file=backup.sql
```

### Reset Database

⚠️ **Warning:** This deletes all data!

```bash
# Drop tables
wrangler d1 execute doc-assistant-db --command="DROP TABLE IF EXISTS files"
wrangler d1 execute doc-assistant-db --command="DROP TABLE IF EXISTS query_log"

# Recreate
wrangler d1 execute doc-assistant-db --file=schema.sql
```

---

## Managing Files (R2)

### List Files in Bucket

```bash
wrangler r2 object list doc-assistant-files
```

### Delete All Files

⚠️ **Warning:** This deletes all uploaded documents!

```bash
wrangler r2 object delete doc-assistant-files --all
```

### Backup Files

R2 doesn't have direct backup, but you can:

1. Download via API
2. Use `rclone` with R2 config
3. Enable R2 bucket versioning

---

## Monitoring & Logs

### View Real-time Logs

```bash
wrangler tail
```

This shows live logs as requests come in.

### View Specific Worker Logs

```bash
wrangler tail --format json
```

### Filter Logs

```bash
wrangler tail --format json | grep "error"
```

---

## Cost Estimation

### Free Tier (per month)

- Workers: 100,000 requests/day = 3M/month (FREE)
- R2: 1GB storage (FREE)
- D1: 5GB storage + 5M reads + 100K writes (FREE)

**Total Free Tier:** $0

### Paid Tier Costs

**Workers:**
- $5/month base
- $0.50 per million requests beyond free tier

**R2:**
- $0.015/GB storage per month
- $0.36 per million Class A operations (writes)
- $4.50 per million Class B operations (reads)

**D1:**
- $5/month (includes 25GB storage)
- $1 per 1M rows read beyond included
- $1 per 1M rows written beyond included

**Gemini 2.5 Flash API:**
- $0.15 per 1M input tokens
- $0.60 per 1M output tokens

### Example: 1000 queries/day

**Assumptions:**
- 10 files uploaded (10MB total)
- 1000 queries per day
- Average 3 tool calls per query
- Average 8000 tokens per query

**Cloudflare Costs:**
- Workers: FREE (well under limit)
- R2: $0.15/month (10MB storage + operations)
- D1: FREE (under limits)

**Gemini Costs:**
- 1000 queries × 8000 tokens × 30 days = 240M tokens
- Input: 240M × $0.15 = $36
- Output: 60M × $0.60 = $36
- **Total: ~$72/month**

**Grand Total: ~$72-$75/month**

For lighter usage (100 queries/day): ~$7-$10/month

---

## Rollback

If deployment breaks something:

### 1. Check Recent Deployments

```bash
wrangler deployments list
```

### 2. Rollback to Previous Version

```bash
wrangler rollback [DEPLOYMENT_ID]
```

Or via Dashboard:
1. Go to Workers & Pages
2. Select `doc-assistant`
3. Click "Deployments"
4. Click "Rollback" on previous version

---

## Custom Domain Setup

### 1. Add Domain to Cloudflare

In Cloudflare Dashboard: Add site → Follow DNS setup

### 2. Add Route to Worker

```bash
wrangler deploy --route="docs.yourdomain.com/*"
```

Or in Dashboard:
1. Workers & Pages → doc-assistant
2. Settings → Triggers
3. Add Custom Domain: `docs.yourdomain.com`

### 3. Update CORS (if needed)

In `src/index.ts`:
```typescript
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://yourdomain.com'
};
```

---

## Troubleshooting Deployment

### Error: "Database not found"

**Solution:**
```bash
# Check database exists
wrangler d1 list

# Recreate if needed
wrangler d1 create doc-assistant-db
```

### Error: "R2 bucket not found"

**Solution:**
```bash
# Check bucket exists
wrangler r2 bucket list

# Recreate if needed
wrangler r2 bucket create doc-assistant-files
```

### Error: "GEMINI_API_KEY not configured"

**Solution:**
```bash
wrangler secret put GEMINI_API_KEY
```

### Error: "Authentication error"

**Solution:**
```bash
wrangler logout
wrangler login
```

### Error: "Build failed"

**Solution:**
```bash
# Clean install
rm -rf node_modules package-lock.json
npm install

# Try deploy again
npm run deploy
```

### Error: "Request size too large"

Your file is too big for free tier (10MB limit).

**Solution:**
- Upgrade to paid tier (100MB limit)
- Or split large files

---

## Production Checklist

Before going live:

- [ ] Custom domain configured
- [ ] CORS restricted to your domain
- [ ] Authentication added (if needed)
- [ ] Rate limiting enabled
- [ ] File size limits set
- [ ] File type validation added
- [ ] Error tracking configured
- [ ] Backups scheduled
- [ ] Monitoring alerts set up
- [ ] Cost limits configured
- [ ] Terms of service displayed
- [ ] Privacy policy added

---

## Next Steps After Deployment

1. **Upload test documents** and verify everything works
2. **Monitor logs** for first few days
3. **Set up alerts** for errors
4. **Add authentication** if needed
5. **Customize UI** to match your brand
6. **Add more tools** if needed
7. **Share with users** and gather feedback

---

**Deployment complete! Your document assistant is live! 🚀**

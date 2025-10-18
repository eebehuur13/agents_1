# Testing Guide

## Quick Test After Deployment

Once deployed, run this automated test:

```bash
bash test-integration.sh https://doc-assistant.YOUR-SUBDOMAIN.workers.dev
```

This will:
1. ✅ Check health endpoint
2. ✅ List files
3. ✅ Upload a test file
4. ✅ Query with AI (needs API key set)
5. ✅ Delete test file

---

## Manual Testing Steps

### 1. Set API Key (Required)

```bash
wrangler secret put GEMINI_API_KEY
```

Paste your Google AI API key from: https://aistudio.google.com/apikey

### 2. Deploy

```bash
npm run deploy
```

### 3. Open Web Interface

Visit: `https://doc-assistant.YOUR-SUBDOMAIN.workers.dev`

### 4. Upload Test Documents

Create test files:

**test-project-plan.txt:**
```
Project Timeline:
- Phase 1: Research (Week 1-2)
- Phase 2: Design (Week 3-5)
- Phase 3: Development (Week 6-10)
- Launch: Week 12
Budget: $50,000
Team: 5 developers
```

**test-meeting-notes.txt:**
```
Meeting Notes - Oct 20, 2025

Attendees: Alice, Bob, Charlie

Key Decisions:
- Approved Q4 budget
- Timeline extended by 2 weeks
- Hired new developer

Action Items:
- Alice: Update project plan
- Bob: Review budget
- Charlie: Schedule interviews
```

Upload both files via the web interface.

### 5. Test AI Queries

Try these queries and verify responses:

#### Query 1: List files
```
What files do I have?
```

**Expected AI behavior:**
```
🤔 Thinking...
⚡ Calling tool: list_files
✓ Got result
✅ Answer: You have 2 files:
1. test-project-plan.txt
2. test-meeting-notes.txt
```

#### Query 2: Specific info
```
What's the project timeline?
```

**Expected AI behavior:**
```
🤔 Thinking...
⚡ Calling tool: list_files
✓ Got result (sees project-plan.txt)
🤔 Thinking...
⚡ Calling tool: read_file
✓ Got result
✅ Answer: The project timeline is:
- Phase 1: Research (Week 1-2)
- Phase 2: Design (Week 3-5)
...
```

#### Query 3: Cross-document
```
What are the action items from the meeting?
```

**Expected AI behavior:**
```
🤔 Thinking...
⚡ Calling tool: search_files (query: "meeting")
✓ Got result
⚡ Calling tool: read_file
✓ Got result
✅ Answer: Action items:
- Alice: Update project plan
- Bob: Review budget
- Charlie: Schedule interviews
```

#### Query 4: Strategic search
```
Who needs to review the budget?
```

**Expected AI behavior:**
```
🤔 Thinking...
⚡ Calling tool: list_files
✓ Got result
⚡ Calling tool: search_files (query: "budget")
✓ Got result (finds meeting-notes)
⚡ Calling tool: read_file
✓ Got result
✅ Answer: Bob needs to review the budget (action item from Oct 20 meeting)
```

---

## Verify AI is Working Correctly

### Good Signs ✅

1. **Strategic thinking**: AI calls `list_files` first, then decides what to read
2. **Targeted reading**: AI only reads files relevant to the question
3. **Multiple steps**: AI makes 2-4 tool calls before answering
4. **Accurate answers**: Responses match document content
5. **Citations**: AI mentions which file the info came from

### Bad Signs ❌

1. **No tool calls**: AI answers without checking files (API key not set)
2. **Random reads**: AI reads all files for simple questions
3. **Errors in stream**: See error events in the UI
4. **Empty responses**: Nothing streams back (check logs)

---

## Debugging

### Check Logs

```bash
wrangler tail
```

Look for:
- Gemini API calls
- Tool executions
- Errors

### Common Issues

#### "GEMINI_API_KEY not configured"

```bash
wrangler secret put GEMINI_API_KEY
```

#### AI doesn't use tools

- Check API key is valid
- Try simpler query first: "What files do I have?"
- Check logs for errors

#### Files upload but can't be read

```bash
# Check R2
wrangler r2 object list doc-assistant-files

# Check D1
wrangler d1 execute doc-assistant-db --command="SELECT * FROM files"
```

#### Streaming doesn't work

- Check browser console for errors
- Make sure SSE is supported
- Try different browser

---

## Performance Testing

### Test with Large File

```bash
# Create 1MB test file
head -c 1000000 /dev/urandom > large-test.bin
base64 large-test.bin > large-test.txt

# Upload via web UI
# Should succeed (free tier supports 10MB)
```

### Test with Many Queries

```bash
# Send 10 queries rapidly
for i in {1..10}; do
  curl -X POST "$BASE_URL/api/query" \
    -H "Content-Type: application/json" \
    -d '{"query":"What files do I have?"}' &
done
wait
```

### Check Response Times

```bash
time curl -X POST "$BASE_URL/api/query" \
  -H "Content-Type: application/json" \
  -d '{"query":"What is the budget?"}'
```

Should be:
- First tool call: < 1s
- Reading file: < 2s
- Final answer: < 1s
- **Total: < 5s**

---

## Cost Testing

### Monitor Token Usage

Check Gemini API dashboard: https://aistudio.google.com/

**Expected for 10 queries:**
- Input tokens: ~50K
- Output tokens: ~10K
- Cost: ~$0.01

### Set Budget Alert

In Google Cloud Console:
1. Go to Billing
2. Set budget alert at $10/month
3. Get emails when 50%, 90% reached

---

## Load Testing (Optional)

### Using Artillery

```bash
npm install -g artillery

# Create artillery.yml
cat > artillery.yml << EOF
config:
  target: "$BASE_URL"
  phases:
    - duration: 60
      arrivalRate: 5
scenarios:
  - flow:
    - post:
        url: "/api/query"
        json:
          query: "What files do I have?"
EOF

artillery run artillery.yml
```

**Free tier limits:**
- 100,000 requests/day
- 10ms CPU per request
- Should handle 5-10 req/sec easily

---

## Security Testing

### Test CORS

```bash
curl -X OPTIONS "$BASE_URL/api/query" \
  -H "Origin: https://evil.com" \
  -v
```

Should allow (CORS is open by default).

**For production**: Restrict to your domain.

### Test File Upload Limits

```bash
# Try uploading 100MB file (should fail on free tier)
dd if=/dev/zero of=huge.bin bs=1M count=100
curl -X POST "$BASE_URL/api/upload" -F "file=@huge.bin"
```

Should return error.

### Test SQL Injection

```bash
curl -X POST "$BASE_URL/api/query" \
  -H "Content-Type: application/json" \
  -d '{"query":"What files\"; DROP TABLE files; --"}'
```

Should be safe (parameterized queries used).

---

## Success Criteria

Before marking as "DONE", verify:

- [x] Deployment successful
- [ ] Health endpoint responds
- [ ] File upload works
- [ ] File listing works
- [ ] File deletion works
- [ ] AI queries work with streaming
- [ ] AI makes strategic tool calls
- [ ] AI answers accurately
- [ ] Response time < 5s
- [ ] Cost per query < $0.01
- [ ] No errors in logs
- [ ] Works on mobile
- [ ] Works in incognito mode

---

## Next: Get Your Google AI API Key

1. Go to: https://aistudio.google.com/apikey
2. Click "Create API Key"
3. Copy the key
4. Run: `wrangler secret put GEMINI_API_KEY`
5. Paste the key
6. Test with: `bash test-integration.sh YOUR_URL`

---

**Once API key is set, the system is fully functional! 🚀**

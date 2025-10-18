# Document Assistant with AI Tool Calling

An intelligent document assistant powered by Google Gemini 2.5 Flash with automated tool calling, strategic reasoning, and real-time streaming.

## 🎯 Features

- **Smart Tool Calling**: AI strategically decides which files to read
- **Real-time Streaming**: Watch AI think and work in real-time
- **File Upload**: Upload documents (PDFs, text files, etc.)
- **Serverless**: Runs on Cloudflare Workers (no servers to manage)
- **Fast & Cheap**: Gemini 2.5 Flash is 20x cheaper than alternatives
- **1M Token Context**: Can handle massive documents

## 🏗️ Architecture

```
User Query
    ↓
Cloudflare Worker (API)
    ↓
Gemini 2.5 Flash (AI)
    ↓
Tool Execution Layer
    ├─ list_files (D1 query)
    ├─ search_files (D1 query)
    ├─ read_file (R2 fetch)
    └─ get_file_metadata (D1 query)
    ↓
R2 (File Storage) + D1 (Metadata)
```

## 📋 Prerequisites

- Node.js 18+
- Cloudflare account (free tier works)
- Google AI API key ([get one here](https://aistudio.google.com/apikey))
- Wrangler CLI installed globally: `npm install -g wrangler`

## 🚀 Setup Instructions

### 1. Clone and Install

```bash
cd /Users/harishadithya/tools/doc-assistant
npm install
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Create R2 Bucket

```bash
wrangler r2 bucket create doc-assistant-files
```

### 4. Create D1 Database

```bash
wrangler d1 create doc-assistant-db
```

Copy the output `database_id` and update `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "doc-assistant-db"
database_id = "YOUR_DATABASE_ID_HERE"  # Paste here
```

### 5. Run Database Migrations

```bash
wrangler d1 execute doc-assistant-db --file=schema.sql
```

### 6. Set Gemini API Key

```bash
wrangler secret put GEMINI_API_KEY
# Paste your API key when prompted
```

### 7. Deploy to Cloudflare

```bash
npm run deploy
```

You'll get a URL like: `https://doc-assistant.YOUR-SUBDOMAIN.workers.dev`

## 🧪 Local Development

```bash
# Start local dev server
npm run dev

# In another terminal, set up local database
npm run db:migrate-local

# Open http://localhost:8787
```

**Note**: For local dev, you need to set the API key in `.dev.vars`:

```bash
echo "GEMINI_API_KEY=your-key-here" > .dev.vars
```

## 📚 API Endpoints

### Health Check
```bash
GET /health
```

### List Files
```bash
GET /api/files
```

### Upload File
```bash
POST /api/upload
Content-Type: multipart/form-data

file: [binary]
```

### Delete File
```bash
DELETE /api/files/{file_id}
```

### Query (Streaming)
```bash
POST /api/query
Content-Type: application/json

{
  "query": "What's the timeline in the project plan?"
}
```

Returns Server-Sent Events (SSE):
```
data: {"type":"thinking","iteration":1}
data: {"type":"tool_call","tool":"list_files","input":{}}
data: {"type":"tool_result","tool":"list_files","result":"..."}
data: {"type":"answer","content":"Based on the document..."}
data: {"type":"done"}
```

## 🧪 Running Tests

```bash
npm test
```

## 💡 Usage Example

### 1. Upload Documents

Open the deployed URL and drag-drop files:
- project-plan.pdf
- meeting-notes.txt
- budget.xlsx

### 2. Ask Questions

Type in the query box:
```
What's the project timeline?
```

### 3. Watch AI Work

You'll see the AI's thought process in real-time:

```
🤔 Thinking... (iteration 1)

💭 Reasoning: User wants timeline. Let me see what files exist.

⚡ Calling tool: list_files

✓ Got result from list_files
  Found 3 files

🤔 Thinking... (iteration 2)

💭 Reasoning: I see project-plan.pdf. Let me read it.

⚡ Calling tool: read_file
  Reading: project-plan.pdf

✓ Got result from read_file

✅ Answer:
Based on the project plan, here's the timeline:
- Phase 1: Research (Weeks 1-2)
- Phase 2: Design (Weeks 3-5)
...
```

## 🛠️ How It Works

### The Agent Loop

1. **User asks question**: "What's the timeline?"
2. **AI thinks**: "I need to find the right document"
3. **AI calls tool**: `list_files()` to see what's available
4. **Tool executes**: Returns list of files from D1
5. **AI thinks again**: "I see project-plan.pdf, let me read it"
6. **AI calls tool**: `read_file(file_id="abc123")`
7. **Tool executes**: Fetches file from R2
8. **AI has answer**: Extracts timeline and formats response

### No Embeddings Needed!

Unlike traditional RAG:
- ❌ No vector database
- ❌ No chunking
- ❌ No embedding generation
- ✅ Just smart tool calling
- ✅ AI strategically explores files
- ✅ Reads only what's needed

### Cost Example

**Query: "What's the timeline?"**

- list_files: 100 tokens = $0.000015
- read_file: 5000 tokens = $0.00075
- Thinking: 2000 tokens = $0.0003
- Answer: 500 tokens = $0.0003
- **Total: ~$0.0014** (less than a penny!)

## 📁 Project Structure

```
doc-assistant/
├── src/
│   ├── index.ts         # Main Worker (API routes, file upload)
│   ├── types.ts         # TypeScript types
│   ├── tools.ts         # Tool execution layer
│   └── gemini.ts        # Gemini integration with streaming
├── tests/
│   └── tools.test.ts    # Unit tests
├── schema.sql           # D1 database schema
├── package.json
├── wrangler.toml        # Cloudflare configuration
└── README.md
```

## 🔧 Configuration

### File Size Limits

Default: No limit (controlled by Cloudflare Workers)

To add limits, modify `src/index.ts`:

```typescript
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

if (file.size > MAX_FILE_SIZE) {
  return new Response(JSON.stringify({ error: 'File too large' }), {
    status: 413
  });
}
```

### Supported File Types

Currently supports:
- Text files (.txt, .md, .json, .csv)
- PDFs (extracted as text)
- Code files (.js, .ts, .py, etc.)

Binary files are stored but content isn't readable by AI.

### Tool Customization

Add new tools in `src/tools.ts`:

```typescript
export const tools: Tool[] = [
  // ... existing tools
  {
    name: 'summarize_file',
    description: 'Generate a summary of a file',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string' }
      },
      required: ['file_id']
    }
  }
];
```

Then implement in `executeTool()` function.

## 🐛 Troubleshooting

### "GEMINI_API_KEY not configured"

```bash
wrangler secret put GEMINI_API_KEY
```

### "Database not found"

Make sure you ran migrations:
```bash
wrangler d1 execute doc-assistant-db --file=schema.sql
```

### "R2 bucket not found"

Check `wrangler.toml` bucket name matches:
```bash
wrangler r2 bucket list
```

### File upload fails

Check Cloudflare Workers limits:
- Free tier: 10MB request size
- Paid tier: 100MB request size

### Tests fail

Install dependencies:
```bash
npm install
```

## 📈 Scaling

### Free Tier Limits (Cloudflare)

- 100,000 requests/day
- 10ms CPU time per request
- 1GB R2 storage
- 5GB D1 storage

### Paid Tier

- Unlimited requests ($0.50 per million)
- 30s CPU time per request
- $0.015/GB R2 storage
- $5/month D1 (includes 25GB)

### For High Volume

1. Add caching for frequently accessed files
2. Implement request queuing for rate limiting
3. Use Cloudflare Analytics for monitoring
4. Consider Cloudflare Durable Objects for session management

## 🔐 Security

### Current Implementation

- CORS enabled for all origins (good for dev)
- No authentication (anyone can upload/query)

### Production Recommendations

1. **Add Authentication**:
   - Use Cloudflare Access
   - Or implement API key auth

2. **Restrict CORS**:
   ```typescript
   const corsHeaders = {
     'Access-Control-Allow-Origin': 'https://yourdomain.com'
   };
   ```

3. **Rate Limiting**:
   ```typescript
   // Use Cloudflare Rate Limiting rules
   ```

4. **File Validation**:
   - Check file types
   - Scan for malware
   - Limit file sizes

## 🎨 Customization

### Change AI Model

Edit `src/gemini.ts`:

```typescript
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-pro-latest', // More powerful but expensive
  // or
  model: 'gemini-2.5-flash-latest', // Fast and cheap (recommended)
});
```

### Adjust Thinking Depth

```typescript
generationConfig: {
  temperature: 0.7,    // Lower = more focused
  maxOutputTokens: 8192 // Increase for longer responses
}
```

### Custom System Instructions

```typescript
systemInstruction: `You are a technical document analyst specializing in software projects. Always cite specific page numbers and sections when answering.`
```

## 📊 Monitoring

### View Logs

```bash
wrangler tail
```

### Check Analytics

Visit: https://dash.cloudflare.com/

Navigate to: Workers & Pages > doc-assistant > Analytics

## 🤝 Contributing

Feel free to modify and extend this project!

### Ideas for Enhancement

- [ ] Add file versioning
- [ ] Implement file tagging
- [ ] Add multi-user support with auth
- [ ] Generate automatic summaries on upload
- [ ] Support more file types (Word, Excel, etc.)
- [ ] Add conversation history
- [ ] Implement file sharing with permissions
- [ ] Add export to PDF/markdown

## 📝 License

MIT

## 🙏 Credits

Built with:
- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Google Gemini 2.5 Flash](https://ai.google.dev/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

## 📞 Support

For issues or questions:
1. Check troubleshooting section above
2. Review Cloudflare Workers docs
3. Check Google AI Studio docs

---

**Built with ❤️ using Cloudflare's edge network and Google's latest AI**

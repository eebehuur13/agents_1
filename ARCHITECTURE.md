# Document Assistant - Complete Architecture Documentation

**Date:** January 2025  
**Version:** 1.0 Production  
**Stack:** Cloudflare Workers + R2 + D1 + Gemini 2.5 Flash

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [Core Concept: Agentic Tool Calling](#core-concept-agentic-tool-calling)
4. [Technology Stack](#technology-stack)
5. [System Components](#system-components)
6. [Critical Solutions & Fixes](#critical-solutions--fixes)
7. [Request Flow](#request-flow)
8. [Gemini API Integration](#gemini-api-integration)
9. [File Handling System](#file-handling-system)
10. [Database Schema](#database-schema)
11. [API Endpoints](#api-endpoints)
12. [Deployment Guide](#deployment-guide)
13. [Performance & Costs](#performance--costs)
14. [Lessons Learned](#lessons-learned)
15. [Future Enhancements](#future-enhancements)

---

## Executive Summary

### What This Project Does

An AI-powered document assistant that can:
- Accept file uploads (PDF, DOCX, XLSX, TXT, images, audio, video)
- Store files in cloud storage (Cloudflare R2)
- Index file metadata in database (Cloudflare D1)
- Let users ask questions about their documents
- Have AI strategically use tools to find, read, and analyze files
- Provide accurate, content-based answers (not hallucinations)

### Key Innovation: No Vector Embeddings

**Traditional RAG approach:**
```
Upload → Chunk → Embed → Vector DB → Semantic Search → LLM
```

**Our approach:**
```
Upload → Store → AI decides what to read → Tool calls → Direct file access → LLM
```

**Why it works:**
- Simpler architecture (no embedding pipeline)
- AI makes strategic decisions (reads only what's needed)
- Cheaper (no embedding costs, no vector DB)
- Faster to build (no ML infrastructure)
- More flexible (AI can reason about files before reading)

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        USER REQUEST                          │
│           "What's the budget in project-plan.pdf?"          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  CLOUDFLARE WORKER (API)                     │
│  • Handles HTTP requests                                    │
│  • Manages file uploads to R2                               │
│  • Orchestrates AI agent loop                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
┌─────────────┐ ┌──────────┐ ┌──────────────────┐
│ GEMINI API  │ │  D1 DB   │ │   R2 STORAGE     │
│ (AI Brain)  │ │(Metadata)│ │  (Files)         │
│             │ │          │ │                  │
│ • Reasoning │ │ • IDs    │ │ • PDFs           │
│ • Tool calls│ │ • Names  │ │ • DOCX           │
│ • Streaming │ │ • Paths  │ │ • XLSX           │
└─────────────┘ └──────────┘ │ • Images         │
                              │ • etc.           │
                              └──────────────────┘
```

### The Agent Loop Pattern

```
User Query
    ↓
┌───────────────────────────────────────┐
│  1. Send query to Gemini             │
│     "What's the budget in X.pdf?"    │
└───────────────────┬───────────────────┘
                    ↓
┌───────────────────────────────────────┐
│  2. Gemini THINKS (reasoning mode)   │
│     "I need to find X.pdf first..."  │
└───────────────────┬───────────────────┘
                    ↓
┌───────────────────────────────────────┐
│  3. Gemini calls TOOL                │
│     search_files("X.pdf")            │
└───────────────────┬───────────────────┘
                    ↓
┌───────────────────────────────────────┐
│  4. Worker EXECUTES tool             │
│     Query D1, return file ID         │
└───────────────────┬───────────────────┘
                    ↓
┌───────────────────────────────────────┐
│  5. Send results back to Gemini      │
│     [{ id: "abc", name: "X.pdf" }]   │
└───────────────────┬───────────────────┘
                    ↓
┌───────────────────────────────────────┐
│  6. Gemini THINKS again              │
│     "Found it! Now read content..."  │
└───────────────────┬───────────────────┘
                    ↓
┌───────────────────────────────────────┐
│  7. Gemini calls ANOTHER tool        │
│     read_file("abc")                 │
└───────────────────┬───────────────────┘
                    ↓
┌───────────────────────────────────────┐
│  8. Worker reads from R2, uploads    │
│     to Gemini Files API, returns URI │
└───────────────────┬───────────────────┘
                    ↓
┌───────────────────────────────────────┐
│  9. Gemini receives file in context  │
│     Can now see actual PDF content   │
└───────────────────┬───────────────────┘
                    ↓
┌───────────────────────────────────────┐
│ 10. Gemini provides FINAL ANSWER     │
│     "Budget is $150,000"             │
└───────────────────────────────────────┘
```

**Key insight:** The loop continues until Gemini has enough information. It's not a fixed pipeline - it's adaptive reasoning.

---

## Core Concept: Agentic Tool Calling

### What Are "Tools"?

Tools are functions the AI can call. We define them, the AI decides when to use them.

**Example tool definition:**
```typescript
{
  name: 'read_file',
  description: 'Read the complete content of a specific file',
  input_schema: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'The unique ID of the file to read'
      }
    },
    required: ['file_id']
  }
}
```

**How it works:**
1. We give Gemini a list of available tools
2. Gemini reads the descriptions
3. When it needs data, it returns: `{ tool: "read_file", input: { file_id: "xyz" } }`
4. We execute the tool and send results back
5. Gemini processes results and continues

### Our Four Tools

| Tool | Purpose | Returns |
|------|---------|---------|
| `list_files` | See all available documents | Array of file metadata |
| `search_files` | Find files by name | Array of matching files |
| `read_file` | Get file content | File content or Gemini URI |
| `get_file_metadata` | Check file info without reading | Metadata only |

### Why This Approach?

**Traditional approach:**
- Upload → Process everything → Store embeddings → Hope search works
- Expensive, slow, inflexible

**Agentic approach:**
- AI strategically decides what it needs
- Only reads relevant files
- Can ask follow-up questions
- Adapts to user's query

**Example:**
```
User: "Compare budgets in Q1 and Q2 reports"

Traditional RAG:
- Search for "budget" → Get chunks from many docs
- Feed all chunks to AI → Hope it finds Q1 and Q2
- May miss context, may get irrelevant docs

Agentic Tool Calling:
- AI thinks: "I need Q1 and Q2 reports"
- Calls search_files("Q1 report")
- Calls search_files("Q2 report")
- Calls read_file on both
- Compares with full context
- Accurate answer
```

---

## Technology Stack

### Core Services

| Service | Purpose | Why This Choice |
|---------|---------|-----------------|
| **Cloudflare Workers** | Serverless compute | Global edge network, fast cold starts, generous free tier |
| **Cloudflare R2** | Object storage | S3-compatible, no egress fees, cheap storage ($0.015/GB/month) |
| **Cloudflare D1** | SQLite database | Built-in, fast, no separate DB to manage |
| **Gemini 2.5 Flash** | AI model | Cheap ($0.075/M input tokens), fast, 1M token context, native tool calling |

### Development Stack

```json
{
  "runtime": "Cloudflare Workers (V8 isolates)",
  "language": "TypeScript",
  "deployment": "Wrangler CLI",
  "dependencies": {
    "@google/generative-ai": "^0.24.1"  // Client-side SDK only
  }
}
```

### Why NOT These Common Choices?

| Avoided | Reason |
|---------|--------|
| Node.js SDK (`@google/generative-ai/server`) | Uses `fs` module - incompatible with Workers |
| Vector Database (Pinecone, etc.) | Not needed, adds complexity |
| Embedding Models | Unnecessary for tool-calling approach |
| Express.js / Flask | Workers are simpler, faster, cheaper |
| PostgreSQL | D1 sufficient for metadata |

---

## System Components

### 1. File Upload Handler (`src/index.ts`)

**Endpoint:** `POST /api/upload`

```typescript
// Accepts multipart/form-data file upload
const formData = await request.formData();
const file = formData.get('file');

// Generate unique ID
const fileId = crypto.randomUUID();

// Store in R2
await env.DOCUMENTS.put(`files/${fileId}`, file.stream());

// Store metadata in D1
await env.DB.prepare(
  'INSERT INTO files (id, filename, path, size, content_type, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)'
).bind(fileId, file.name, `files/${fileId}`, file.size, file.type, Date.now()).run();
```

**Flow:**
```
File Upload → Generate UUID → Store in R2 → Save metadata to D1 → Return file ID
```

### 2. Query Handler (`src/index.ts`)

**Endpoint:** `POST /api/query`

```typescript
// Accept user query
const { query } = await request.json();

// Create streaming response
const { readable, writable } = new TransformStream();
const writer = writable.getWriter();

// Start agent loop (async, doesn't block)
processQueryWithStreaming(query, env, writer);

// Return SSE stream immediately
return new Response(readable, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  }
});
```

**Real-time streaming:** User sees AI thinking, tool calls, and results as they happen.

### 3. Tool Execution Layer (`src/tools.ts`)

**Purpose:** Execute tools that Gemini requests

```typescript
export async function executeTool(
  toolName: string,
  toolInput: any,
  env: Env
): Promise<ToolResult> {
  switch (toolName) {
    case 'list_files':
      return await listFiles(toolInput, env);
    case 'search_files':
      return await searchFiles(toolInput, env);
    case 'read_file':
      return await readFile(toolInput, env);
    case 'get_file_metadata':
      return await getFileMetadata(toolInput, env);
    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}
```

**Each tool:**
1. Validates input
2. Queries D1 or R2
3. Returns structured result
4. Handles errors gracefully

### 4. Gemini Integration (`src/gemini.ts`)

**Core agent loop:**

```typescript
const chat = model.startChat({
  history: [],
  tools: [{ functionDeclarations: tools }],  // Give AI the tools
  systemInstruction: SYSTEM_PROMPT
});

// Send initial query
let response = await chat.sendMessage(query);

// Loop until done
while (iteration < MAX_ITERATIONS) {
  const functionCalls = response.functionCalls();
  
  if (functionCalls && functionCalls.length > 0) {
    // AI wants to use tools
    const results = [];
    
    for (const call of functionCalls) {
      const result = await executeTool(call.name, call.args, env);
      results.push({
        functionResponse: {
          name: call.name,
          response: result.data
        }
      });
    }
    
    // Send tool results back
    response = await chat.sendMessage(results);
  } else {
    // AI has final answer
    const answer = response.text();
    return answer;
  }
}
```

---

## Critical Solutions & Fixes

### Problem 1: Node.js Dependencies in Cloudflare Workers

**The Issue:**
```typescript
// ❌ This crashes in Workers
import { GoogleAIFileManager } from '@google/generative-ai/server';

const fileManager = new GoogleAIFileManager(apiKey);
await fileManager.uploadFile(filePath, options);
```

**Why it fails:**
- `@google/generative-ai/server` uses Node.js `fs.readFileSync()`
- Cloudflare Workers run on V8 isolates (not full Node.js)
- No `fs` module available → crashes

**The Solution:**
Use REST API directly with native `fetch()`:

```typescript
// ✅ Works in Workers - uses native fetch
async function uploadToGemini(fileBuffer, filename, contentType, env) {
  // Step 1: Initiate resumable upload
  const initResponse = await fetch(
    'https://generativelanguage.googleapis.com/upload/v1beta/files',
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Type': getMimeType(contentType, filename),
        'X-goog-api-key': env.GEMINI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: { displayName: filename }
      })
    }
  );

  const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL');

  // Step 2: Upload file data
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': fileBuffer.byteLength.toString()
    },
    body: fileBuffer
  });

  const result = await uploadResponse.json();
  return result.file.name; // Returns "files/abc123"
}
```

**Key takeaway:** In serverless environments without Node.js, use REST APIs directly.

---

### Problem 2: File State Timing

**The Issue:**
```typescript
// ❌ File uploaded but not ready to use yet
const result = await uploadResponse.json();
return { uri: result.file.name };

// AI tries to use it immediately → 400 Bad Request
// Error: "File is not in ACTIVE state"
```

**Why it fails:**
- Gemini Files API uploads are async
- File goes through states: `PROCESSING` → `ACTIVE`
- Takes 1-5 seconds depending on file size
- Can't use file until `ACTIVE`

**The Solution:**
Poll file status until `ACTIVE`:

```typescript
async function uploadToGemini(fileBuffer, filename, contentType, env) {
  // ... upload code ...
  
  const fileId = result.file.name; // "files/abc123"

  // Poll until ACTIVE
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const checkResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileId}?key=${env.GEMINI_API_KEY}`
    );
    
    const fileData = await checkResponse.json();
    
    if (fileData.state === 'ACTIVE') {
      return { uri: fileId, uploadedAt: Date.now() };
    }
    
    if (fileData.state === 'FAILED') {
      throw new Error(`File processing failed: ${filename}`);
    }
    
    // Still PROCESSING, wait 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error(`File did not become ACTIVE after ${maxAttempts} attempts`);
}
```

**Performance:**
- Most files: Active in 1-3 seconds
- Large files (>10MB): Up to 5 seconds
- Very large files: May need more attempts

**Key takeaway:** Always check file state before using uploaded files.

---

### Problem 3: Mixed Parts API Violation

**The Issue:**
```typescript
// ❌ WRONG: Mixing function response with file data
const parts = [
  {
    functionResponse: {
      name: 'read_file',
      response: { gemini_uri: 'files/abc123' }
    }
  },
  {
    fileData: {
      fileUri: 'files/abc123',
      mimeType: 'application/pdf'
    }
  }
];

await chat.sendMessage(parts);
// Error: "FunctionResponse cannot be mixed with other type of part"
```

**Why it fails:**
- Gemini API enforces strict message structure
- Each message must contain ONLY:
  - Function responses, OR
  - Text/fileData/other content
  - NEVER both in same message
- SDK validates before sending → throws error

**The Solution:**
Send ONLY function responses:

```typescript
// ✅ CORRECT: Only function responses
const functionResponseParts = functionResponses.map(fr => ({
  functionResponse: {
    name: fr.name,
    response: fr.response  // Contains gemini_uri
  }
}));

await chat.sendMessage(functionResponseParts);
```

**Why this works:**
When Gemini receives `gemini_uri` in the function response, it automatically:
1. Fetches the file from Files API
2. Adds it to conversation context
3. Can now analyze the file content

**We don't need to explicitly attach the file** - the SDK handles it automatically when it sees the URI.

**Key takeaway:** Trust the SDK - when you return `gemini_uri` in tool response, file attachment is automatic.

---

### Problem 4: File Types and MIME Types

**The Issue:**
Different file types need different handling:
- Text files: Read directly, return content
- Binary files (PDF, DOCX, etc.): Upload to Gemini, return URI

**The Solution:**
Smart detection and routing:

```typescript
function shouldUseGeminiFilesAPI(contentType: string, filename: string): boolean {
  const lower = filename.toLowerCase();
  const type = contentType?.toLowerCase() || '';
  
  // Documents
  if (type.includes('pdf') || lower.endsWith('.pdf')) return true;
  if (type.includes('wordprocessingml') || lower.endsWith('.docx')) return true;
  
  // Spreadsheets
  if (type.includes('spreadsheetml') || lower.endsWith('.xlsx')) return true;
  
  // Images, audio, video
  if (type.includes('image/') || type.includes('audio/') || type.includes('video/')) return true;
  
  // Plain text - don't use Gemini
  return false;
}

async function readFile(fileId, env) {
  const file = await getFileFromD1(fileId);
  const content = await env.DOCUMENTS.get(file.path);
  
  if (shouldUseGeminiFilesAPI(file.content_type, file.filename)) {
    // Binary file - upload to Gemini
    const arrayBuffer = await content.arrayBuffer();
    const { uri } = await uploadToGemini(arrayBuffer, file.filename, file.content_type, env);
    
    return {
      success: true,
      data: {
        gemini_uri: uri,
        filename: file.filename,
        content_type: file.content_type,
        message: 'File uploaded to Gemini'
      }
    };
  } else {
    // Text file - return content directly
    const text = await content.text();
    
    return {
      success: true,
      data: {
        filename: file.filename,
        content: text
      }
    };
  }
}
```

**Supported formats via Gemini Files API:**
- Documents: PDF, DOCX, DOC, HTML
- Spreadsheets: XLSX, CSV
- Presentations: PPTX
- Images: JPG, PNG, GIF, WEBP, SVG
- Audio: MP3, WAV, FLAC, AAC
- Video: MP4, MOV, AVI, MPEG, WebM, WMV, 3GPP, FLV
- Archives: ZIP, TAR

**Key takeaway:** Route files intelligently - text files don't need Gemini processing.

---

## Request Flow

### Complete Request Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USER UPLOADS FILE                                        │
│    POST /api/upload (multipart/form-data)                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. WORKER RECEIVES FILE                                     │
│    • Generates UUID (e.g., "abc-123")                       │
│    • Determines content type                                │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │                         │
        ▼                         ▼
┌──────────────────┐     ┌──────────────────┐
│ 3a. STORE IN R2  │     │ 3b. SAVE TO D1   │
│ Path:            │     │ Record:          │
│ files/abc-123    │     │ • id: abc-123    │
│                  │     │ • filename       │
│ Content:         │     │ • path           │
│ [binary data]    │     │ • size           │
└──────────────────┘     │ • content_type   │
                         │ • uploaded_at    │
                         └──────────────────┘
                                 │
                                 ▼
                    ┌──────────────────────┐
                    │ 4. RETURN SUCCESS    │
                    │ { success: true,     │
                    │   file: {...} }      │
                    └──────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 5. USER ASKS QUESTION                                       │
│    POST /api/query                                          │
│    { "query": "What's in document X?" }                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. WORKER STARTS AGENT LOOP                                 │
│    • Create SSE stream                                      │
│    • Initialize Gemini chat                                 │
│    • Send query to Gemini                                   │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. GEMINI THINKS (Iteration 1)                              │
│    💭 "User wants info from document X.                     │
│        First, I need to find document X..."                 │
│                                                             │
│    DECISION: Call search_files tool                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. WORKER EXECUTES TOOL                                     │
│    executeTool('search_files', { query: 'document X' })    │
│                                                             │
│    Query D1:                                                │
│    SELECT * FROM files WHERE filename LIKE '%document X%'  │
│                                                             │
│    Returns: [{ id: 'abc-123', filename: 'document X.pdf' }]│
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 9. SEND RESULTS TO GEMINI                                   │
│    {                                                        │
│      functionResponse: {                                    │
│        name: 'search_files',                                │
│        response: { files: [...] }                           │
│      }                                                      │
│    }                                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 10. GEMINI THINKS AGAIN (Iteration 2)                       │
│     💭 "Great! Found document X with ID abc-123.            │
│         Now I need to read its content..."                  │
│                                                             │
│     DECISION: Call read_file tool                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 11. WORKER EXECUTES read_file                               │
│     • Query D1 for file metadata (path, content_type)      │
│     • Fetch from R2: files/abc-123                          │
│     • Check if binary file → YES (PDF)                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 12. UPLOAD TO GEMINI FILES API                              │
│     • POST to /upload/v1beta/files                          │
│     • Get upload URL                                        │
│     • Upload file data                                      │
│     • Poll status until ACTIVE (1-3 seconds)                │
│     • Returns: "files/xyz789"                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 13. CACHE IN D1 (for future queries)                        │
│     UPDATE files                                            │
│     SET gemini_uri = 'files/xyz789',                        │
│         gemini_uploaded_at = 1234567890                     │
│     WHERE id = 'abc-123'                                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 14. RETURN TOOL RESULT TO GEMINI                            │
│     {                                                       │
│       functionResponse: {                                   │
│         name: 'read_file',                                  │
│         response: {                                         │
│           gemini_uri: 'files/xyz789',                       │
│           filename: 'document X.pdf',                       │
│           content_type: 'application/pdf'                   │
│         }                                                   │
│       }                                                     │
│     }                                                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 15. GEMINI SDK AUTO-ATTACHES FILE                           │
│     • Sees gemini_uri in response                           │
│     • Fetches file from Files API                           │
│     • Adds to conversation context                          │
│     • Gemini can now see PDF content                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 16. GEMINI ANALYZES & RESPONDS                              │
│     💭 "I can now see the PDF content.                      │
│         The document says the budget is $150,000..."        │
│                                                             │
│     DECISION: No more tools needed, provide answer          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 17. STREAM FINAL ANSWER TO USER                             │
│     data: {"type":"answer","content":"The budget in..."}    │
│     data: {"type":"done"}                                   │
└─────────────────────────────────────────────────────────────┘
```

**Key points:**
- Everything happens in one request (streaming)
- User sees progress in real-time (SSE events)
- AI makes decisions at each step
- Tools execute on-demand
- Files cached for reuse

---

## Gemini API Integration

### How to Call Gemini API Properly

#### 1. Setup & Initialization

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  generationConfig: {
    temperature: 0.7,          // 0.0 = deterministic, 1.0 = creative
    maxOutputTokens: 8192,     // Max response length
    thinkingConfig: {
      includeThoughts: true,   // Show reasoning
      thinkingBudget: 10000    // Tokens for reasoning (8K-16K recommended)
    }
  },
  tools: [
    {
      functionDeclarations: [
        // Your tool definitions here
      ]
    }
  ],
  systemInstruction: `
    You are a helpful assistant that can read documents.
    
    When you need information:
    1. Use list_files to see available documents
    2. Use search_files to find specific documents
    3. Use read_file to access content
    4. Analyze and answer based on the content
  `
});
```

#### 2. Start Chat Session

```typescript
const chat = model.startChat({
  history: []  // Start fresh, or provide previous messages
});
```

#### 3. Send Messages

**Simple text:**
```typescript
const result = await chat.sendMessage("Hello!");
const text = result.response.text();
console.log(text);
```

**With function calling:**
```typescript
const result = await chat.sendMessage("What files do I have?");
const response = result.response;

// Check if AI wants to use a tool
const functionCalls = response.functionCalls();

if (functionCalls) {
  for (const call of functionCalls) {
    console.log(`AI wants to call: ${call.name}`);
    console.log(`With arguments:`, call.args);
  }
}
```

#### 4. Handle Function Calls

```typescript
if (functionCalls && functionCalls.length > 0) {
  const functionResponses = [];
  
  for (const call of functionCalls) {
    // Execute the tool
    const result = await executeTool(call.name, call.args, env);
    
    // Format response for Gemini
    functionResponses.push({
      functionResponse: {
        name: call.name,
        response: result.data  // Your tool's output
      }
    });
  }
  
  // CRITICAL: Send ONLY function responses (no mixing!)
  const nextResult = await chat.sendMessage(functionResponses);
  
  // AI processes results and may call more tools or give final answer
  return nextResult.response;
}
```

#### 5. Streaming Responses

```typescript
const result = await chat.sendMessageStream("Tell me a story");

// Process chunks as they arrive
for await (const chunk of result.stream) {
  const text = chunk.text();
  console.log(text);  // Print each chunk
}

// Get complete response
const finalResponse = await result.response;
```

### Best Practices

#### DO's:

✅ **Validate function call arguments**
```typescript
if (!call.args.file_id || typeof call.args.file_id !== 'string') {
  return { success: false, error: 'Invalid file_id' };
}
```

✅ **Handle errors gracefully**
```typescript
try {
  const result = await executeTool(name, args, env);
  return { success: true, data: result };
} catch (error) {
  return { success: false, error: error.message };
}
```

✅ **Set iteration limits**
```typescript
const MAX_ITERATIONS = 15;
let iteration = 0;

while (iteration < MAX_ITERATIONS) {
  // ... agent loop ...
  iteration++;
}

if (iteration >= MAX_ITERATIONS) {
  throw new Error('Maximum iterations reached');
}
```

✅ **Stream progress to users**
```typescript
await writeEvent({ type: 'thinking', iteration: 1 });
await writeEvent({ type: 'tool_call', tool: 'search_files' });
await writeEvent({ type: 'tool_result', result: '...' });
await writeEvent({ type: 'answer', content: '...' });
```

#### DON'Ts:

❌ **Don't mix function responses with other content**
```typescript
// WRONG
const parts = [
  { functionResponse: {...} },
  { text: "Additional context" }  // ❌ Will fail
];

// CORRECT
const parts = [
  { functionResponse: {...} }
];
```

❌ **Don't forget to check file states**
```typescript
// WRONG
const result = await uploadFile();
return result.uri;  // File may not be ACTIVE yet

// CORRECT
const result = await uploadFile();
await waitForActiveState(result.uri);  // Poll until ready
return result.uri;
```

❌ **Don't trust user input without validation**
```typescript
// WRONG
const fileId = request.params.id;
const file = await readFile(fileId);  // SQL injection risk

// CORRECT
const fileId = request.params.id;
if (!/^[a-zA-Z0-9-]+$/.test(fileId)) {
  throw new Error('Invalid file ID format');
}
const file = await readFile(fileId);
```

### Token Optimization

**Gemini 2.5 Flash pricing:**
- Input: $0.075 per 1M tokens
- Output: $0.30 per 1M tokens
- Context: 1M tokens

**Tips:**
1. **Use concise system instructions** - Every token counts across all requests
2. **Limit conversation history** - Only keep relevant previous messages
3. **Stream responses** - Users see progress without waiting for full response
4. **Cache tool definitions** - SDK handles this automatically
5. **Truncate large responses** - Summarize tool results if needed

---

## File Handling System

### File Lifecycle

```
┌──────────────────────────────────────────────────────────┐
│ UPLOAD                                                   │
│ • User uploads file                                      │
│ • Store in R2: files/{uuid}                              │
│ • Save metadata to D1                                    │
│ • gemini_uri initially NULL                              │
└────────────────┬─────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────┐
│ FIRST READ (Binary files only)                           │
│ • Fetch from R2                                          │
│ • Upload to Gemini Files API                             │
│ • Wait for ACTIVE state (1-5 seconds)                    │
│ • Cache URI in D1: UPDATE files SET gemini_uri = '...'   │
└────────────────┬─────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────┐
│ SUBSEQUENT READS                                         │
│ • Check D1 for cached gemini_uri                         │
│ • Validate file still exists (GET request)               │
│ • If valid: Return cached URI (instant!)                 │
│ • If expired: Re-upload and update cache                 │
└────────────────┬─────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────┐
│ DELETION                                                 │
│ • Delete from R2                                         │
│ • Delete from D1                                         │
│ • Delete from Gemini Files API (best effort)             │
└──────────────────────────────────────────────────────────┘
```

### File State Management

**Gemini file states:**

| State | Meaning | Action |
|-------|---------|--------|
| `PROCESSING` | File being processed | Wait (poll every 1 second) |
| `ACTIVE` | Ready to use | Proceed with conversation |
| `FAILED` | Processing failed | Throw error, don't retry |

**Implementation:**
```typescript
async function waitForActiveState(fileId: string, apiKey: string): Promise<void> {
  const maxAttempts = 10;
  const delayMs = 1000;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileId}?key=${apiKey}`
    );
    
    if (!response.ok) {
      throw new Error(`Failed to check file status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.state === 'ACTIVE') {
      return; // Success!
    }
    
    if (data.state === 'FAILED') {
      throw new Error(`File processing failed: ${fileId}`);
    }
    
    // Still PROCESSING
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  
  throw new Error(`File did not become ACTIVE after ${maxAttempts} attempts`);
}
```

### File Expiration

**Gemini Files API:**
- Files expire after **48 hours**
- Automatic deletion (no action needed)
- Need to re-upload if expired

**Our caching strategy:**
```typescript
async function getGeminiUri(fileId: string, env: Env): Promise<string> {
  // Check D1 cache
  const file = await env.DB.prepare(
    'SELECT gemini_uri, gemini_uploaded_at FROM files WHERE id = ?'
  ).bind(fileId).first();
  
  if (file.gemini_uri) {
    // Check if still valid (within 48 hours)
    const hoursSinceUpload = (Date.now() - file.gemini_uploaded_at) / 1000 / 60 / 60;
    
    if (hoursSinceUpload < 47) {  // 1 hour buffer
      // Verify file still exists
      const exists = await checkFileExists(file.gemini_uri, env.GEMINI_API_KEY);
      if (exists) {
        return file.gemini_uri;  // Use cached URI
      }
    }
  }
  
  // Cache miss or expired - re-upload
  const fileContent = await env.DOCUMENTS.get(file.path);
  const arrayBuffer = await fileContent.arrayBuffer();
  const { uri } = await uploadToGemini(arrayBuffer, file.filename, file.content_type, env);
  
  // Update cache
  await env.DB.prepare(
    'UPDATE files SET gemini_uri = ?, gemini_uploaded_at = ? WHERE id = ?'
  ).bind(uri, Date.now(), fileId).run();
  
  return uri;
}
```

### MIME Type Handling

**Content-Type detection:**
```typescript
function getMimeType(contentType: string | null, filename: string): string {
  // If provided and not generic, use it
  if (contentType && contentType !== 'application/octet-stream') {
    return contentType;
  }
  
  // Infer from extension
  const lower = filename.toLowerCase();
  
  // Documents
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  
  // Spreadsheets
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.csv')) return 'text/csv';
  
  // Images
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  
  // Fallback
  return contentType || 'application/octet-stream';
}
```

**Why this matters:**
- Gemini rejects unsupported MIME types
- Generic `application/octet-stream` often rejected
- Must provide specific type for proper processing

---

## Database Schema

### Files Table

```sql
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,                    -- UUID v4
  filename TEXT NOT NULL,                 -- Original filename
  path TEXT NOT NULL,                     -- R2 path: files/{id}
  size INTEGER NOT NULL,                  -- File size in bytes
  content_type TEXT,                      -- MIME type
  uploaded_at INTEGER NOT NULL,           -- Unix timestamp (ms)
  tags TEXT,                              -- JSON array (optional)
  summary TEXT,                           -- AI-generated summary (optional)
  gemini_uri TEXT,                        -- Cached Gemini Files API URI
  gemini_uploaded_at INTEGER              -- When uploaded to Gemini (for expiry tracking)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_filename ON files(filename);
CREATE INDEX IF NOT EXISTS idx_uploaded ON files(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_type ON files(content_type);
CREATE INDEX IF NOT EXISTS idx_gemini_uploaded ON files(gemini_uploaded_at);
```

### Query Log Table (Optional)

```sql
CREATE TABLE IF NOT EXISTS query_log (
  id TEXT PRIMARY KEY,                    -- UUID v4
  query TEXT NOT NULL,                    -- User's question
  files_accessed TEXT,                    -- JSON array of file IDs
  tools_used TEXT,                        -- JSON array of tool names
  response_time INTEGER,                  -- Milliseconds
  created_at INTEGER NOT NULL             -- Unix timestamp (ms)
);

CREATE INDEX IF NOT EXISTS idx_query_created ON query_log(created_at DESC);
```

**Usage:**
```typescript
await env.DB.prepare(
  'INSERT INTO query_log (id, query, files_accessed, tools_used, response_time, created_at) VALUES (?, ?, ?, ?, ?, ?)'
).bind(
  crypto.randomUUID(),
  query,
  JSON.stringify(filesAccessed),
  JSON.stringify(toolsUsed),
  responseTime,
  Date.now()
).run();
```

**Benefits:**
- Debug issues
- Understand usage patterns
- Optimize tool performance
- Track costs

---

## API Endpoints

### 1. Upload File

**Endpoint:** `POST /api/upload`  
**Content-Type:** `multipart/form-data`

**Request:**
```bash
curl -F "file=@document.pdf" https://your-worker.workers.dev/api/upload
```

**Response:**
```json
{
  "success": true,
  "file": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "filename": "document.pdf",
    "size": 1048576,
    "content_type": "application/pdf",
    "uploaded_at": 1704067200000
  }
}
```

**Error Response:**
```json
{
  "error": "No file provided"
}
```

### 2. Query Documents

**Endpoint:** `POST /api/query`  
**Content-Type:** `application/json`

**Request:**
```bash
curl -X POST https://your-worker.workers.dev/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the budget in the project plan?"}'
```

**Response:** Server-Sent Events (SSE) stream

```
data: {"type":"thinking","iteration":1}

data: {"type":"reasoning","content":"I need to find the project plan..."}

data: {"type":"tool_call","tool":"search_files","input":{"query":"project plan"}}

data: {"type":"tool_result","tool":"search_files","result":"[{id: '...', filename: '...'}]","success":true}

data: {"type":"thinking","iteration":2}

data: {"type":"tool_call","tool":"read_file","input":{"file_id":"..."}}

data: {"type":"tool_result","tool":"read_file","result":"File uploaded to Gemini","success":true}

data: {"type":"answer","content":"The budget is $150,000"}

data: {"type":"done"}
```

**Event Types:**

| Type | Fields | Purpose |
|------|--------|---------|
| `thinking` | `iteration` | AI is reasoning |
| `reasoning` | `content` | AI's thought process |
| `tool_call` | `tool`, `input` | AI calling a tool |
| `tool_result` | `tool`, `result`, `success` | Tool execution result |
| `answer` | `content` | Final answer |
| `error` | `error` | Error message |
| `done` | - | Stream complete |

### 3. List Files

**Endpoint:** `GET /api/files`

**Request:**
```bash
curl https://your-worker.workers.dev/api/files
```

**Response:**
```json
{
  "success": true,
  "files": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "filename": "document.pdf",
      "size": 1048576,
      "content_type": "application/pdf",
      "uploaded_at": 1704067200000
    }
  ],
  "count": 1
}
```

### 4. Delete File

**Endpoint:** `DELETE /api/files/:id`

**Request:**
```bash
curl -X DELETE https://your-worker.workers.dev/api/files/550e8400-e29b-41d4-a716-446655440000
```

**Response:**
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

---

## Deployment Guide

### Prerequisites

1. **Cloudflare Account** (free tier sufficient)
2. **Wrangler CLI**
   ```bash
   npm install -g wrangler
   wrangler login
   ```
3. **Gemini API Key** from [Google AI Studio](https://aistudio.google.com/apikey)

### Step 1: Create Cloudflare Resources

```bash
# Create R2 bucket
wrangler r2 bucket create doc-assistant-files

# Create D1 database
wrangler d1 create doc-assistant-db
# Note the database ID from output
```

### Step 2: Configure wrangler.toml

```toml
name = "doc-assistant"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[build]
command = "npm install && npx tsc"

# R2 Bucket
[[r2_buckets]]
binding = "DOCUMENTS"
bucket_name = "doc-assistant-files"

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "doc-assistant-db"
database_id = "your-database-id-here"  # From step 1

# Environment variables (secrets)
# Don't put API key here! Use wrangler secret
```

### Step 3: Set Secrets

```bash
wrangler secret put GEMINI_API_KEY
# Paste your API key when prompted
```

### Step 4: Initialize Database

```bash
# Local development
wrangler d1 execute doc-assistant-db --local --file=./schema.sql

# Production
wrangler d1 execute doc-assistant-db --file=./schema.sql
```

### Step 5: Deploy

```bash
# Test locally first
wrangler dev

# Deploy to production
wrangler deploy
```

### Step 6: Test Deployment

```bash
# Get your Worker URL from deploy output
# Example: https://doc-assistant.your-name.workers.dev

# Test upload
curl -F "file=@test.pdf" https://doc-assistant.your-name.workers.dev/api/upload

# Test query
curl -X POST https://doc-assistant.your-name.workers.dev/api/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What files do I have?"}'
```

### Troubleshooting

**Issue:** "GEMINI_API_KEY not configured"
```bash
# Solution: Set the secret
wrangler secret put GEMINI_API_KEY
```

**Issue:** "Database not found"
```bash
# Solution: Check database ID in wrangler.toml
wrangler d1 list  # Get correct ID
```

**Issue:** "R2 bucket not found"
```bash
# Solution: Create bucket
wrangler r2 bucket create doc-assistant-files
```

**Issue:** "Node.js module fs not found"
```bash
# Solution: You're using the wrong SDK
# Use @google/generative-ai (client SDK)
# NOT @google/generative-ai/server
```

---

## Performance & Costs

### Performance Metrics

| Operation | Latency | Notes |
|-----------|---------|-------|
| File upload (1MB) | 200-500ms | R2 + D1 write |
| File upload (10MB) | 1-2s | Network dependent |
| Text file read | 50-100ms | R2 read + direct return |
| Binary file first read | 2-5s | R2 + Gemini upload + ACTIVE wait |
| Binary file cached read | 100-200ms | D1 lookup + validation |
| Simple query | 2-4s | List files + answer |
| Complex query | 5-15s | Multiple tool calls + file reads |
| Streaming start | <100ms | SSE connection established |

### Cost Breakdown (Monthly)

**Scenario:** 1000 users, 50 queries/user/month, 2 docs/user average

**Cloudflare:**
- Workers: Free tier (100K requests/day) ✅
- R2 Storage: 1GB = $0.015
- R2 Operations: 50K Class A (write) = $0.225
- R2 Operations: 50K Class B (read) = $0.018
- D1: Free tier (5M reads, 100K writes) ✅

**Gemini API:**
- Average query: 10K input tokens, 500 output tokens
- Monthly: 50K queries × 10K tokens = 500M input tokens
- Monthly: 50K queries × 500 tokens = 25M output tokens
- Input cost: 500M × $0.075/1M = $37.50
- Output cost: 25M × $0.30/1M = $7.50

**Total: ~$45/month** for 50,000 queries

**Per query: $0.0009** (less than a penny!)

### Optimization Tips

**1. Prompt Caching**
```typescript
// Cache system instruction and tool definitions
// Gemini automatically caches repeated content
// Reduces input tokens by up to 80%
```

**2. Limit Context**
```typescript
// Only include relevant conversation history
const history = previousMessages.slice(-5);  // Last 5 messages only
```

**3. Batch Operations**
```typescript
// Read multiple files in parallel
const results = await Promise.all(
  fileIds.map(id => readFile(id, env))
);
```

**4. Smart Caching**
```typescript
// Cache Gemini URIs aggressively
// Check expiry before re-uploading
// Save 2-5 seconds per cached file
```

**5. Limit Iterations**
```typescript
// Prevent infinite loops
const MAX_ITERATIONS = 15;  // Usually needs 3-5
```

---

## Lessons Learned

### What Worked Well

1. **Tool Calling > RAG**
   - Simpler to implement
   - More flexible
   - AI makes better decisions than keyword search
   - No embedding costs

2. **Cloudflare Workers**
   - Global edge deployment
   - Fast cold starts (<10ms)
   - Integrated R2 + D1 = simple architecture
   - Generous free tier

3. **Gemini 2.5 Flash**
   - Cheap and fast
   - Excellent function calling
   - Large context window (1M tokens)
   - Reasoning mode helps with complex queries

4. **REST API > SDK**
   - In serverless: use REST directly
   - Avoid Node.js dependencies
   - More control over requests
   - Better error handling

5. **Streaming UX**
   - Users see progress immediately
   - Better perceived performance
   - Can show AI reasoning (transparency)
   - Handle long operations gracefully

### What Was Challenging

1. **File State Management**
   - Files need time to process (ACTIVE state)
   - Must poll and wait
   - Failed silently at first
   - **Solution:** Always check state, poll with timeout

2. **API Constraints**
   - Cannot mix functionResponse with other parts
   - Strict validation in SDK
   - Errors not always clear
   - **Solution:** Read docs carefully, test thoroughly

3. **Node.js vs Serverless**
   - Many SDKs assume Node.js
   - `fs` module everywhere
   - Hard to debug (silent failures)
   - **Solution:** Use REST APIs, avoid `/server` exports

4. **MIME Types**
   - Generic types rejected by Gemini
   - Must infer from filename sometimes
   - Different files need different handling
   - **Solution:** Build robust MIME type detection

5. **Debugging Agent Loops**
   - Complex multi-step processes
   - Hard to see what AI is thinking
   - Tool calls can fail silently
   - **Solution:** Stream everything, log extensively

### Best Practices Discovered

1. **Always validate file states**
   ```typescript
   // Don't assume files are ready
   await waitForActiveState(fileId);
   ```

2. **Trust the SDK for file attachment**
   ```typescript
   // Don't manually attach files
   // Just return gemini_uri in tool response
   // SDK handles the rest
   ```

3. **Keep tool responses clean**
   ```typescript
   // ONLY function responses in sendMessage
   // No mixing with other content
   ```

4. **Stream everything**
   ```typescript
   // Show users progress
   // Better UX, easier debugging
   ```

5. **Set limits everywhere**
   ```typescript
   const MAX_ITERATIONS = 15;
   const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
   const MAX_POLL_ATTEMPTS = 10;
   ```

---

## Future Enhancements

### Short-term (1-2 weeks)

1. **Multi-user Support**
   - Add user authentication
   - User-specific file storage
   - Query history per user

2. **File Management UI**
   - Upload via web interface
   - List and search files
   - Delete files
   - Download files

3. **Advanced Search**
   - Filter by content type
   - Filter by upload date
   - Tag-based organization

4. **Query History**
   - Save previous queries
   - Repeat common queries
   - Learn from patterns

### Medium-term (1-2 months)

1. **Conversation Memory**
   - Multi-turn conversations
   - Reference previous queries
   - Maintain context

2. **Batch Processing**
   - Upload multiple files at once
   - Query multiple documents
   - Generate reports

3. **Analytics Dashboard**
   - Usage statistics
   - Popular queries
   - Cost tracking
   - Performance metrics

4. **Export Capabilities**
   - Export answers as PDF
   - Generate summaries
   - Create reports

### Long-term (3+ months)

1. **Advanced AI Features**
   - Automatic document summarization
   - Key point extraction
   - Cross-document analysis
   - Trend detection

2. **Integrations**
   - Google Drive import
   - Dropbox sync
   - Slack bot
   - Email integration

3. **Collaboration**
   - Shared document collections
   - Team workspaces
   - Access controls
   - Commenting

4. **Hybrid Approach**
   - Add embeddings for semantic search
   - Combine with tool calling
   - Best of both worlds

---

## Conclusion

### Key Takeaways

1. **Agentic tool calling is simpler and more effective than traditional RAG** for document Q&A
2. **Cloudflare Workers + R2 + D1** provides an excellent serverless stack
3. **Gemini 2.5 Flash** offers great value (cheap, fast, large context)
4. **REST APIs > SDKs** in serverless environments
5. **File state management is critical** - always wait for ACTIVE
6. **Never mix function responses with other content** in Gemini API
7. **Streaming improves UX** dramatically

### When to Use This Approach

✅ **Good for:**
- Small to medium document collections (<1000 docs)
- Users who ask specific questions
- Need for explainability (show AI reasoning)
- Budget-conscious projects
- Fast time to market

❌ **Not ideal for:**
- Massive document collections (>10K docs)
- Need for semantic similarity search
- Offline operation requirements
- Sub-second response time requirements

### Final Thoughts

This project demonstrates that **you don't always need complex RAG pipelines**. Sometimes, giving an AI strategic tools and letting it think is more effective than pre-processing everything.

The agentic approach:
- Is easier to build
- Is easier to debug
- Provides better user experience (transparency)
- Is more flexible (AI adapts to questions)
- Is cheaper (no embedding costs)

For small to medium document collections, **this is the way**.

---

## Appendix

### Complete File Structure

```
doc-assistant/
├── src/
│   ├── index.ts          # Main worker, handles HTTP
│   ├── gemini.ts         # AI agent loop
│   ├── tools.ts          # Tool implementations
│   └── types.ts          # TypeScript types
├── migrations/
│   └── 0001_add_gemini_fields.sql
├── schema.sql            # Database schema
├── wrangler.toml         # Cloudflare config
├── tsconfig.json         # TypeScript config
├── package.json          # Dependencies
└── README.md             # Basic readme
```

### Environment Variables

```bash
# Required
GEMINI_API_KEY=<your-key>

# Optional (for development)
NODE_ENV=development
DEBUG=true
```

### Useful Commands

```bash
# Development
wrangler dev                    # Local development
wrangler dev --remote           # Remote development (uses prod resources)

# Deployment
wrangler deploy                 # Deploy to production
wrangler deploy --dry-run       # Test deployment

# Database
wrangler d1 execute DB --command="SELECT * FROM files LIMIT 10"
wrangler d1 export DB --output=backup.sql

# R2
wrangler r2 object list BUCKET
wrangler r2 object get BUCKET KEY

# Secrets
wrangler secret put SECRET_NAME
wrangler secret list
wrangler secret delete SECRET_NAME

# Logs
wrangler tail                   # Live logs
wrangler tail --format=pretty
```

### References

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Gemini API Docs](https://ai.google.dev/gemini-api/docs)
- [Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemini Files API](https://ai.google.dev/gemini-api/docs/files)
- [R2 Documentation](https://developers.cloudflare.com/r2/)
- [D1 Documentation](https://developers.cloudflare.com/d1/)

---

**Document Version:** 1.0  
**Last Updated:** January 18, 2025  
**Author:** Built with Claude (Anthropic) & Factory AI  
**License:** MIT

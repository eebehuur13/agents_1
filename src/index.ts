import { Env, QueryRequest, FileMetadata } from './types';
import { processQueryWithStreaming } from './gemini';
import { deleteFromGemini } from './tools';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check
      if (path === '/health' && request.method === 'GET') {
        return new Response(
          JSON.stringify({ status: 'ok', timestamp: Date.now() }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // List files
      if (path === '/api/files' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT id, filename, size, content_type, uploaded_at FROM files ORDER BY uploaded_at DESC LIMIT 100'
        ).all();

        return new Response(JSON.stringify({ files: results || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Upload file
      if (path === '/api/upload' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file || typeof file === 'string') {
          return new Response(JSON.stringify({ error: 'No file provided' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Generate unique ID
        const fileId = crypto.randomUUID();
        const filename = (file as File).name;
        const contentType = (file as File).type || 'application/octet-stream';
        const size = (file as File).size;
        const uploadedAt = Date.now();
        const path = `files/${fileId}`;

        // Upload to R2
        const arrayBuffer = await (file as File).arrayBuffer();
        await env.DOCUMENTS.put(path, arrayBuffer, {
          httpMetadata: {
            contentType: contentType,
          },
        });

        // Save metadata to D1
        await env.DB.prepare(
          'INSERT INTO files (id, filename, path, size, content_type, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
          .bind(fileId, filename, path, size, contentType, uploadedAt)
          .run();

        return new Response(
          JSON.stringify({
            success: true,
            file: {
              id: fileId,
              filename,
              size,
              content_type: contentType,
              uploaded_at: uploadedAt,
            },
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Delete file
      if (path.startsWith('/api/files/') && request.method === 'DELETE') {
        const fileId = path.split('/').pop();

        if (!fileId) {
          return new Response(JSON.stringify({ error: 'Invalid file ID' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Get file metadata (including gemini_uri)
        const file = await env.DB.prepare('SELECT path, gemini_uri FROM files WHERE id = ?')
          .bind(fileId)
          .first<{ path: string; gemini_uri: string | null }>();

        if (!file) {
          return new Response(JSON.stringify({ error: 'File not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Delete from R2
        await env.DOCUMENTS.delete(file.path);

        // Delete from Gemini if it was uploaded there
        if (file.gemini_uri) {
          await deleteFromGemini(file.gemini_uri, env);
        }

        // Delete from D1
        await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();

        return new Response(
          JSON.stringify({ success: true, message: 'File deleted' }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Query with streaming
      if (path === '/api/query' && request.method === 'POST') {
        const body = await request.json<QueryRequest>();
        const query = body.query;

        if (!query || typeof query !== 'string' || query.trim().length === 0) {
          return new Response(JSON.stringify({ error: 'Invalid query' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Check if Gemini API key is set
        if (!env.GEMINI_API_KEY) {
          return new Response(
            JSON.stringify({
              error:
                'GEMINI_API_KEY not configured. Set it using: wrangler secret put GEMINI_API_KEY',
            }),
            {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        // Set up streaming response
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();

        // Process query in background
        ctx.waitUntil(
          (async () => {
            try {
              await processQueryWithStreaming(query, env, writer);
            } catch (error) {
              console.error('Query processing error:', error);
            } finally {
              await writer.close();
            }
          })()
        );

        return new Response(readable, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      }

      // Get file content
      if (path.startsWith('/api/files/') && path.endsWith('/content') && request.method === 'GET') {
        const parts = path.split('/');
        const fileId = parts[parts.length - 2];

        if (!fileId) {
          return new Response(JSON.stringify({ error: 'Invalid file ID' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const file = await env.DB.prepare('SELECT * FROM files WHERE id = ?')
          .bind(fileId)
          .first<FileMetadata>();

        if (!file) {
          return new Response(JSON.stringify({ error: 'File not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const object = await env.DOCUMENTS.get(file.path);

        if (!object) {
          return new Response(
            JSON.stringify({ error: 'File not found in storage' }),
            {
              status: 404,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        return new Response(object.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': file.content_type || 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${file.filename}"`,
          },
        });
      }

      // Serve static files (for local dev)
      if (path === '/' || path === '/index.html') {
        return new Response(indexHtml, {
          headers: { ...corsHeaders, 'Content-Type': 'text/html' },
        });
      }

      return new Response('Not Found', {
        status: 404,
        headers: corsHeaders,
      });
    } catch (error: any) {
      console.error('Request error:', error);
      return new Response(
        JSON.stringify({ error: error.message || 'Internal server error' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  },
};

// Embedded HTML for easy testing
const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document Assistant</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; max-width: 1200px; margin: 0 auto; background: #f5f5f5; }
        .container { background: white; border-radius: 8px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { margin-bottom: 24px; color: #333; }
        h2 { margin-bottom: 16px; color: #555; font-size: 18px; }
        .upload-area { border: 2px dashed #ccc; border-radius: 8px; padding: 40px; text-align: center; cursor: pointer; transition: all 0.3s; }
        .upload-area:hover { border-color: #4285f4; background: #f8f9fa; }
        .upload-area.dragging { border-color: #4285f4; background: #e8f0fe; }
        input[type="file"] { display: none; }
        .files-list { margin-top: 20px; }
        .file-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid #e0e0e0; border-radius: 4px; margin-bottom: 8px; }
        .file-info { flex: 1; }
        .file-name { font-weight: 500; color: #333; }
        .file-meta { font-size: 12px; color: #666; margin-top: 4px; }
        .btn-delete { background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .btn-delete:hover { background: #c82333; }
        textarea { width: 100%; padding: 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; font-family: inherit; resize: vertical; }
        button { background: #4285f4; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500; }
        button:hover { background: #3367d6; }
        button:disabled { background: #ccc; cursor: not-allowed; }
        .events { margin-top: 20px; }
        .event { padding: 12px; border-radius: 4px; margin-bottom: 8px; border-left: 4px solid; }
        .event-thinking { background: #f1f3f4; border-color: #5f6368; }
        .event-reasoning { background: #fce8f3; border-color: #9c27b0; }
        .event-tool-call { background: #e3f2fd; border-color: #2196f3; }
        .event-tool-result { background: #e8f5e9; border-color: #4caf50; }
        .event-answer { background: #fff3e0; border-color: #ff9800; }
        .event-error { background: #ffebee; border-color: #f44336; }
        .event-type { font-weight: 600; font-size: 12px; text-transform: uppercase; margin-bottom: 4px; }
        .event-content { font-size: 14px; white-space: pre-wrap; }
        code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-family: 'Monaco', monospace; font-size: 13px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 Document Assistant</h1>
        <p style="color: #666; margin-bottom: 24px;">Upload documents and ask questions. The AI will strategically search and read files to answer you.</p>
        
        <h2>📁 Upload Files</h2>
        <div class="upload-area" id="uploadArea">
            <p>Click or drag files here to upload</p>
            <input type="file" id="fileInput" multiple>
        </div>
        
        <div class="files-list" id="filesList"></div>
    </div>
    
    <div class="container">
        <h2>💬 Ask a Question</h2>
        <textarea id="queryInput" rows="3" placeholder="e.g., What's the timeline in the project plan?"></textarea>
        <button id="askBtn" style="margin-top: 12px;">Ask Question</button>
        
        <div class="events" id="events"></div>
    </div>
    
    <script>
        const API_BASE = '';
        
        // File upload
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const filesList = document.getElementById('filesList');
        
        uploadArea.addEventListener('click', () => fileInput.click());
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragging');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragging');
        });
        
        uploadArea.addEventListener('drop', async (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragging');
            const files = e.dataTransfer.files;
            for (const file of files) {
                await uploadFile(file);
            }
        });
        
        fileInput.addEventListener('change', async (e) => {
            for (const file of e.target.files) {
                await uploadFile(file);
            }
            fileInput.value = '';
        });
        
        async function uploadFile(file) {
            const formData = new FormData();
            formData.append('file', file);
            
            try {
                const response = await fetch(API_BASE + '/api/upload', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    await loadFiles();
                } else {
                    alert('Upload failed: ' + await response.text());
                }
            } catch (error) {
                alert('Upload error: ' + error.message);
            }
        }
        
        async function loadFiles() {
            try {
                const response = await fetch(API_BASE + '/api/files');
                const data = await response.json();
                
                filesList.innerHTML = data.files.map(file => \`
                    <div class="file-item">
                        <div class="file-info">
                            <div class="file-name">\${file.filename}</div>
                            <div class="file-meta">\${formatSize(file.size)} · \${formatDate(file.uploaded_at)}</div>
                        </div>
                        <button class="btn-delete" onclick="deleteFile('\${file.id}')">Delete</button>
                    </div>
                \`).join('');
            } catch (error) {
                console.error('Failed to load files:', error);
            }
        }
        
        async function deleteFile(id) {
            if (!confirm('Delete this file?')) return;
            
            try {
                await fetch(API_BASE + '/api/files/' + id, { method: 'DELETE' });
                await loadFiles();
            } catch (error) {
                alert('Delete failed: ' + error.message);
            }
        }
        
        function formatSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        }
        
        function formatDate(timestamp) {
            return new Date(timestamp).toLocaleDateString();
        }
        
        // Query handling
        const queryInput = document.getElementById('queryInput');
        const askBtn = document.getElementById('askBtn');
        const eventsDiv = document.getElementById('events');
        
        askBtn.addEventListener('click', async () => {
            const query = queryInput.value.trim();
            if (!query) return;
            
            askBtn.disabled = true;
            eventsDiv.innerHTML = '';
            
            try {
                const response = await fetch(API_BASE + '/api/query', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query })
                });
                
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\\n');
                    
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') continue;
                            
                            try {
                                const event = JSON.parse(data);
                                addEvent(event);
                            } catch (e) {}
                        }
                    }
                }
            } catch (error) {
                addEvent({ type: 'error', error: error.message });
            } finally {
                askBtn.disabled = false;
            }
        });
        
        function addEvent(event) {
            const div = document.createElement('div');
            div.className = 'event event-' + event.type;
            
            let content = '';
            
            switch (event.type) {
                case 'thinking':
                    content = \`<div class="event-type">🤔 Thinking (Iteration \${event.iteration})</div>\`;
                    break;
                case 'reasoning':
                    content = \`<div class="event-type">💭 Reasoning</div><div class="event-content">\${event.content}</div>\`;
                    break;
                case 'tool_call':
                    content = \`<div class="event-type">⚡ Tool Call</div><div class="event-content">Calling <code>\${event.tool}</code></div>\`;
                    break;
                case 'tool_result':
                    content = \`<div class="event-type">\${event.success ? '✓' : '✗'} Tool Result</div><div class="event-content">Result from <code>\${event.tool}</code></div>\`;
                    break;
                case 'answer':
                    content = \`<div class="event-type">✅ Answer</div><div class="event-content">\${event.content}</div>\`;
                    break;
                case 'error':
                    content = \`<div class="event-type">❌ Error</div><div class="event-content">\${event.error}</div>\`;
                    break;
                case 'done':
                    return;
            }
            
            div.innerHTML = content;
            eventsDiv.appendChild(div);
            div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        
        // Load files on start
        loadFiles();
    </script>
</body>
</html>`;

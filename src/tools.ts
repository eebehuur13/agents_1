import { Env, Tool, ToolResult, FileMetadata } from './types';

// Tool definitions for Gemini
export const tools: Tool[] = [
  {
    name: 'list_files',
    description:
      'List all available files in the document storage. Use this first to see what documents exist. Returns filename, ID, size, and upload date.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of files to return (default: 50, max: 100)',
        },
        content_type: {
          type: 'string',
          description: 'Filter by content type (e.g., "application/pdf", "text/plain")',
        },
      },
    },
  },
  {
    name: 'search_files',
    description:
      'Search for files by filename. Use this when looking for specific documents by name.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term to match against filenames',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read the complete content of a specific file. Use this to get the actual document content when you need to answer questions about what\'s inside a file.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description: 'The unique ID of the file to read',
        },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'get_file_metadata',
    description:
      'Get metadata about a file without reading its content. Use this to check file size, upload date, or content type before reading.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: {
          type: 'string',
          description: 'The unique ID of the file',
        },
      },
      required: ['file_id'],
    },
  },
];

// Execute a tool
export async function executeTool(
  toolName: string,
  toolInput: any,
  env: Env
): Promise<ToolResult> {
  try {
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
        return {
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Tool execution failed',
    };
  }
}

// List files
async function listFiles(input: any, env: Env): Promise<ToolResult> {
  const limit = Math.min(input.limit || 50, 100);
  const contentType = input.content_type;

  let query = 'SELECT id, filename, size, content_type, uploaded_at FROM files';
  const params: any[] = [];

  if (contentType) {
    query += ' WHERE content_type = ?';
    params.push(contentType);
  }

  query += ' ORDER BY uploaded_at DESC LIMIT ?';
  params.push(limit);

  const stmt = env.DB.prepare(query);
  const { results } = await (params.length > 0
    ? stmt.bind(...params).all()
    : stmt.all());

  return {
    success: true,
    data: {
      files: results || [],
      count: results?.length || 0,
    },
  };
}

// Search files by name
async function searchFiles(input: any, env: Env): Promise<ToolResult> {
  const query = input.query;

  if (!query || typeof query !== 'string') {
    return {
      success: false,
      error: 'Query parameter is required and must be a string',
    };
  }

  const searchPattern = `%${query}%`;
  const stmt = env.DB.prepare(
    'SELECT id, filename, size, uploaded_at FROM files WHERE filename LIKE ? ORDER BY uploaded_at DESC LIMIT 20'
  );

  const { results } = await stmt.bind(searchPattern).all();

  return {
    success: true,
    data: {
      files: results || [],
      count: results?.length || 0,
      query: query,
    },
  };
}

// Helper: Determine if file should be handled by Gemini Files API
function shouldUseGeminiFilesAPI(contentType: string | null, filename: string): boolean {
  if (!contentType && !filename) return false;
  
  const lower = filename.toLowerCase();
  const type = contentType?.toLowerCase() || '';
  
  // Documents
  if (type.includes('pdf') || lower.endsWith('.pdf')) return true;
  if (type.includes('wordprocessingml.document') || lower.endsWith('.docx')) return true;
  if (type.includes('msword') || lower.endsWith('.doc')) return true;
  if (type.includes('html') || lower.endsWith('.html')) return true;
  
  // Spreadsheets
  if (type.includes('spreadsheetml.sheet') || lower.endsWith('.xlsx')) return true;
  if (type.includes('csv') || lower.endsWith('.csv')) return true;
  
  // Presentations
  if (type.includes('presentationml') || lower.endsWith('.pptx')) return true;
  
  // Images
  if (type.includes('image/')) return true;
  if (lower.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) return true;
  
  // Audio
  if (type.includes('audio/')) return true;
  if (lower.match(/\.(mp3|wav|flac|aac)$/)) return true;
  
  // Video
  if (type.includes('video/')) return true;
  if (lower.match(/\.(mp4|mov|avi|mpeg|mpg|webm|wmv|3gpp|flv)$/)) return true;
  
  // Archives
  if (type.includes('zip') || lower.endsWith('.zip')) return true;
  if (type.includes('tar') || lower.endsWith('.tar')) return true;
  
  return false;
}

// Helper: Get MIME type for Gemini upload
function getMimeType(contentType: string | null, filename: string): string {
  // If we have a valid content type, use it
  if (contentType && contentType !== 'application/octet-stream') {
    return contentType;
  }
  
  // Otherwise infer from filename
  const lower = filename.toLowerCase();
  
  // Documents
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.txt')) return 'text/plain';
  
  // Spreadsheets
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.csv')) return 'text/csv';
  
  // Presentations
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  
  // Images
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  
  // Audio
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.flac')) return 'audio/flac';
  if (lower.endsWith('.aac')) return 'audio/aac';
  
  // Video
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.avi')) return 'video/x-msvideo';
  if (lower.endsWith('.mpeg') || lower.endsWith('.mpg')) return 'video/mpeg';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.wmv')) return 'video/x-ms-wmv';
  if (lower.endsWith('.3gpp')) return 'video/3gpp';
  if (lower.endsWith('.flv')) return 'video/x-flv';
  
  // Archives
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.tar')) return 'application/x-tar';
  
  // Fallback
  return contentType || 'application/octet-stream';
}

// Helper: Upload file to Gemini Files API using REST API (Cloudflare Workers compatible)
async function uploadToGemini(
  fileBuffer: ArrayBuffer,
  filename: string,
  contentType: string | null,
  env: Env
): Promise<{ uri: string; uploadedAt: number }> {
  const mimeType = getMimeType(contentType, filename);
  const fileSize = fileBuffer.byteLength;

  // Step 1: Initiate resumable upload
  const initResponse = await fetch(
    'https://generativelanguage.googleapis.com/upload/v1beta/files',
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'X-goog-api-key': env.GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        file: {
          displayName: filename,
        },
      }),
    }
  );

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    throw new Error(`Failed to initiate upload: ${initResponse.status} ${errorText}`);
  }

  const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error('No upload URL received from Gemini API');
  }

  // Step 2: Upload file data
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': fileSize.toString(),
    },
    body: fileBuffer,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Failed to upload file: ${uploadResponse.status} ${errorText}`);
  }

  const result = await uploadResponse.json() as { file: { name: string; uri: string } };

  return {
    uri: result.file.name, // Returns "files/abc123" format
    uploadedAt: Date.now(),
  };
}

// Helper: Delete file from Gemini Files API using REST API (exported for use in delete endpoint)
export async function deleteFromGemini(geminiUri: string, env: Env): Promise<void> {
  try {
    // geminiUri is in format 'files/xyz'
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${geminiUri}?key=${env.GEMINI_API_KEY}`,
      {
        method: 'DELETE',
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Failed to delete from Gemini: ${response.status} ${errorText}`);
    }
  } catch (error) {
    console.error('Failed to delete from Gemini:', error);
  }
}

// Helper: Check if file exists in Gemini using REST API (by trying to get it)
async function checkGeminiFile(geminiUri: string, env: Env): Promise<boolean> {
  try {
    // geminiUri is in format 'files/xyz'
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${geminiUri}?key=${env.GEMINI_API_KEY}`,
      {
        method: 'GET',
      }
    );
    return response.ok; // File exists if 200 OK
  } catch (error) {
    return false; // File doesn't exist or expired
  }
}

// Read file content
async function readFile(input: any, env: Env): Promise<ToolResult> {
  const fileId = input.file_id;

  if (!fileId || typeof fileId !== 'string') {
    return {
      success: false,
      error: 'file_id parameter is required and must be a string',
    };
  }

  // Get file metadata from D1
  const stmt = env.DB.prepare('SELECT * FROM files WHERE id = ?');
  const file = await stmt.bind(fileId).first<FileMetadata>();

  if (!file) {
    return {
      success: false,
      error: `File not found: ${fileId}`,
    };
  }

  // Read file from R2
  const object = await env.DOCUMENTS.get(file.path);

  if (!object) {
    return {
      success: false,
      error: `File exists in database but not in storage: ${fileId}`,
    };
  }

  // Check if this file should be handled by Gemini Files API
  const useGemini = shouldUseGeminiFilesAPI(file.content_type, file.filename);

  if (useGemini) {
    try {
      let geminiUri = file.gemini_uri;

      // If we have a cached URI, check if it still works
      if (geminiUri) {
        const stillValid = await checkGeminiFile(geminiUri, env);
        
        if (!stillValid) {
          // Expired or deleted - clear it so we re-upload
          geminiUri = null;
        }
      }

      // Upload to Gemini if we don't have a valid URI
      if (!geminiUri) {
        const arrayBuffer = await object.arrayBuffer();
        const result = await uploadToGemini(arrayBuffer, file.filename, file.content_type, env);
        
        geminiUri = result.uri;

        // Update database with new Gemini URI
        await env.DB.prepare(
          'UPDATE files SET gemini_uri = ?, gemini_uploaded_at = ? WHERE id = ?'
        )
          .bind(geminiUri, result.uploadedAt, file.id)
          .run();
      }

      return {
        success: true,
        data: {
          id: file.id,
          filename: file.filename,
          size: file.size,
          content_type: file.content_type,
          gemini_uri: geminiUri,
          message: `File uploaded to Gemini. You can now analyze this ${file.content_type || 'file'} using the gemini_uri.`,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to process file with Gemini: ${error.message || error}`,
      };
    }
  }

  // Handle plain text files directly (no Gemini needed)
  let content: string;
  try {
    if (file.content_type?.includes('text') || file.content_type?.includes('json')) {
      content = await object.text();
    } else {
      // For other binary files
      content = `[Binary file: ${file.filename}, ${file.size} bytes, type: ${file.content_type}. Content cannot be displayed as text.]`;
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to read file content: ${error}`,
    };
  }

  return {
    success: true,
    data: {
      id: file.id,
      filename: file.filename,
      size: file.size,
      content_type: file.content_type,
      content: content,
    },
  };
}

// Get file metadata
async function getFileMetadata(input: any, env: Env): Promise<ToolResult> {
  const fileId = input.file_id;

  if (!fileId || typeof fileId !== 'string') {
    return {
      success: false,
      error: 'file_id parameter is required and must be a string',
    };
  }

  const stmt = env.DB.prepare('SELECT * FROM files WHERE id = ?');
  const file = await stmt.bind(fileId).first<FileMetadata>();

  if (!file) {
    return {
      success: false,
      error: `File not found: ${fileId}`,
    };
  }

  return {
    success: true,
    data: {
      id: file.id,
      filename: file.filename,
      size: file.size,
      content_type: file.content_type,
      uploaded_at: file.uploaded_at,
      tags: file.tags ? JSON.parse(file.tags) : [],
      summary: file.summary,
    },
  };
}

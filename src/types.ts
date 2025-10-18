// Environment bindings
export interface Env {
  DOCUMENTS: R2Bucket;
  DB: D1Database;
  GEMINI_API_KEY: string;
}

// File metadata
export interface FileMetadata {
  id: string;
  filename: string;
  path: string;
  size: number;
  content_type: string | null;
  uploaded_at: number;
  tags: string | null;
  summary: string | null;
  gemini_uri: string | null;
  gemini_uploaded_at: number | null;
}

// Tool definitions
export interface Tool {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

// Tool execution result
export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

// Streaming event types
export type StreamEvent =
  | { type: 'thinking'; iteration: number }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call'; tool: string; input: any }
  | { type: 'tool_result'; tool: string; result: string; success: boolean }
  | { type: 'answer'; content: string }
  | { type: 'error'; error: string }
  | { type: 'done' };

// Query request
export interface QueryRequest {
  query: string;
}

// Upload request
export interface UploadRequest {
  filename: string;
  content_type?: string;
}

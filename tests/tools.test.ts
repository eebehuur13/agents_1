import { describe, it, expect, beforeEach } from 'vitest';
import { executeTool, tools } from '../src/tools';

// Mock environment
const createMockEnv = () => {
  const files = new Map<string, { content: string; metadata: any }>();

  return {
    DOCUMENTS: {
      async get(key: string) {
        const file = files.get(key);
        if (!file) return null;
        return {
          text: async () => file.content,
          arrayBuffer: async () => new TextEncoder().encode(file.content).buffer,
        };
      },
      async put(key: string, content: any) {
        files.set(key, { content: content.toString(), metadata: {} });
      },
      async delete(key: string) {
        files.delete(key);
      },
      _files: files, // For testing
    },
    DB: {
      async prepare(sql: string) {
        // Mock D1 database
        const mockData = [
          {
            id: 'file-1',
            filename: 'project-plan.pdf',
            path: 'files/file-1',
            size: 2500000,
            content_type: 'application/pdf',
            uploaded_at: 1729468800,
            tags: null,
            summary: null,
          },
          {
            id: 'file-2',
            filename: 'meeting-notes.txt',
            path: 'files/file-2',
            size: 15000,
            content_type: 'text/plain',
            uploaded_at: 1729468900,
            tags: null,
            summary: null,
          },
        ];

        const self = {
          async bind(...params: any[]) {
            return self;
          },
          async all() {
            if (sql.includes('WHERE filename LIKE')) {
              // Search files
              const results = mockData.filter((f) =>
                f.filename.toLowerCase().includes('project')
              );
              return { results };
            }
            if (sql.includes('ORDER BY uploaded_at DESC')) {
              // List files
              return { results: mockData };
            }
            return { results: [] };
          },
          async first() {
            if (sql.includes('WHERE id = ?')) {
              return mockData[0];
            }
            return null;
          },
          async run() {
            return { success: true };
          },
        };
        return self;
      },
    },
    GEMINI_API_KEY: 'test-key',
  } as any;
};

describe('Tools', () => {
  it('should have all required tools defined', () => {
    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.name)).toEqual([
      'list_files',
      'search_files',
      'read_file',
      'get_file_metadata',
    ]);
  });

  describe('list_files', () => {
    it('should list files successfully', async () => {
      const env = createMockEnv();
      const result = await executeTool('list_files', { limit: 50 }, env);

      expect(result.success).toBe(true);
      expect(result.data.files).toHaveLength(2);
      expect(result.data.count).toBe(2);
    });

    it('should respect limit parameter', async () => {
      const env = createMockEnv();
      const result = await executeTool('list_files', { limit: 1 }, env);

      expect(result.success).toBe(true);
      expect(result.data.count).toBeGreaterThan(0);
    });

    it('should not exceed max limit', async () => {
      const env = createMockEnv();
      const result = await executeTool('list_files', { limit: 1000 }, env);

      expect(result.success).toBe(true);
      // Should be capped at 100
    });
  });

  describe('search_files', () => {
    it('should search files by name', async () => {
      const env = createMockEnv();
      const result = await executeTool('search_files', { query: 'project' }, env);

      expect(result.success).toBe(true);
      expect(result.data.count).toBeGreaterThan(0);
    });

    it('should return error for invalid query', async () => {
      const env = createMockEnv();
      const result = await executeTool('search_files', {}, env);

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });
  });

  describe('read_file', () => {
    it('should read file content', async () => {
      const env = createMockEnv();

      // Add file content to mock R2
      env.DOCUMENTS._files.set('files/file-1', {
        content: 'File content here',
        metadata: {},
      });

      const result = await executeTool('read_file', { file_id: 'file-1' }, env);

      expect(result.success).toBe(true);
      expect(result.data.filename).toBe('project-plan.pdf');
    });

    it('should return error for missing file', async () => {
      const env = createMockEnv();
      const result = await executeTool('read_file', { file_id: 'nonexistent' }, env);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should require file_id parameter', async () => {
      const env = createMockEnv();
      const result = await executeTool('read_file', {}, env);

      expect(result.success).toBe(false);
      expect(result.error).toContain('required');
    });
  });

  describe('get_file_metadata', () => {
    it('should return file metadata', async () => {
      const env = createMockEnv();
      const result = await executeTool(
        'get_file_metadata',
        { file_id: 'file-1' },
        env
      );

      expect(result.success).toBe(true);
      expect(result.data.id).toBe('file-1');
      expect(result.data.filename).toBe('project-plan.pdf');
      expect(result.data.size).toBe(2500000);
    });
  });

  describe('executeTool', () => {
    it('should return error for unknown tool', async () => {
      const env = createMockEnv();
      const result = await executeTool('unknown_tool', {}, env);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });

    it('should handle tool execution errors', async () => {
      const env = createMockEnv();

      // Break the DB to cause an error
      env.DB.prepare = async () => {
        throw new Error('Database error');
      };

      const result = await executeTool('list_files', {}, env);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

import { GoogleGenerativeAI, Content, Part, FunctionCall, SchemaType } from '@google/generative-ai';
import { Env, StreamEvent } from './types';
import { tools, executeTool } from './tools';

// Convert our tool definitions to Gemini format
function convertToolsToGeminiFormat() {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: SchemaType.OBJECT,
      properties: tool.input_schema.properties,
      required: tool.input_schema.required || [],
    },
  }));
}

// Process query with streaming
export async function processQueryWithStreaming(
  query: string,
  env: Env,
  writer: WritableStreamDefaultWriter<Uint8Array>
): Promise<void> {
  const encoder = new TextEncoder();

  // Helper to write SSE events
  const writeEvent = async (event: StreamEvent) => {
    await writer.write(
      encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
    );
  };

  try {
    const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

    // Initialize model with thinking mode and tools
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
        // Enable thinking/reasoning mode
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: 10000, // Tokens for reasoning (8000-16000 recommended)
        },
      } as any, // Type workaround for thinkingConfig
      tools: [
        {
          functionDeclarations: convertToolsToGeminiFormat(),
        },
      ],
      systemInstruction: `You are a powerful document assistant with the ability to read and analyze files. 

CAPABILITIES:
- You CAN read file contents using read_file tool
- You CAN search for specific files using search_files
- You CAN list all available files using list_files
- You CAN analyze and summarize document content
- You CAN answer questions by reading multiple files

FILE HANDLING WITH GEMINI:
When you call read_file on supported file types (PDF, DOCX, XLSX, PPTX, images, audio, video, etc.), 
you will receive a "gemini_uri" in the response. This means THE FILE HAS BEEN LOADED INTO YOUR CONTEXT.

IMPORTANT: Once you receive a gemini_uri, you can IMMEDIATELY analyze the file content. 
- For XLSX/CSV: You can see all rows, columns, values, formulas
- For DOCX/PDF: You can read all text, see structure, tables, formatting
- For images: You can see what's in the image
- For audio/video: You can understand the content

DO NOT say "I would need to see the data" - you HAVE the data. Just analyze it directly.

Supported file types via Gemini:
- Documents: PDF, DOCX, HTML
- Spreadsheets: XLSX, CSV
- Presentations: PPTX
- Images: JPG, PNG, GIF, WEBP, SVG
- Audio: MP3, WAV, FLAC, AAC
- Video: MP4, MOV, AVI, MPEG, WebM
- Archives: ZIP, TAR

Plain text files (.txt, .json, .md) are returned as direct text content, not URIs.

WORKFLOW:
1. When asked about file contents: first list_files or search_files to find the right file, then read_file to get the content
2. When asked to summarize: read the file(s) first, then provide a summary
3. When comparing files: read all relevant files, then compare
4. DO NOT call the exact same tool with the exact same parameters repeatedly - that's a loop
5. You CAN call different tools in sequence to accomplish a task

EXAMPLES:
- "What files do I have?" → list_files, then answer
- "Summarize file X" → search_files OR list_files to find it, then read_file, then provide summary
- "What's the timeline?" → list_files to see available docs, read_file on relevant file(s), then extract timeline
- "Compare X and Y" → read_file X, read_file Y, then compare

You are NOT limited to just listing files - you can and SHOULD read them when needed!`,
    });

    // Start chat session
    const chat = model.startChat({
      history: [],
    });

    // Agent loop
    let iteration = 0;
    const MAX_ITERATIONS = 15; // Increased for multi-step operations
    
    // Send initial query
    const initialResult = await chat.sendMessage(query);
    let response = initialResult.response;

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      // Send thinking indicator
      await writeEvent({ type: 'thinking', iteration });
      
      // Check if response has any text content (reasoning/thinking)
      try {
        const text = response.text();
        if (text && text.length > 0) {
          await writeEvent({
            type: 'reasoning',
            content: text,
          });
        }
      } catch (e) {
        // No text content, that's fine
      }

      // Check for function calls
      const functionCalls = response.functionCalls();

      if (functionCalls && functionCalls.length > 0) {
        // Model wants to use tools
        const functionResponses: any[] = [];

        for (const functionCall of functionCalls) {
          const toolName = functionCall.name;
          const toolArgs = functionCall.args;

          // Stream tool call event
          await writeEvent({
            type: 'tool_call',
            tool: toolName,
            input: toolArgs,
          });

          // Execute tool
          const toolResult = await executeTool(toolName, toolArgs, env);

          // Stream tool result
          await writeEvent({
            type: 'tool_result',
            tool: toolName,
            result: toolResult.success
              ? JSON.stringify(toolResult.data).substring(0, 200) + '...'
              : toolResult.error || 'Unknown error',
            success: toolResult.success,
          });

          // Prepare response for model
          functionResponses.push({
            name: toolName,
            response: toolResult.success
              ? toolResult.data
              : { error: toolResult.error },
          });
        }

        // Send ALL function responses back to model
        const parts = functionResponses.map(fr => ({
          functionResponse: {
            name: fr.name,
            response: fr.response,
          },
        }));
        
        const functionResult = await chat.sendMessage(parts as any);
        
        // Update response for next iteration
        response = functionResult.response;
        
        // Check if this response has a text answer (not more function calls)
        const nextFunctionCalls = response.functionCalls();
        
        if (!nextFunctionCalls || nextFunctionCalls.length === 0) {
          // Model has given final answer - show it
          try {
            const text = response.text();
            if (text) {
              await writeEvent({
                type: 'answer',
                content: text,
              });
            }
          } catch (e) {
            // If no text and no function calls, something is wrong
            await writeEvent({
              type: 'error',
              error: 'Model stopped without providing an answer',
            });
          }
          break;
        }

        // Continue loop - response now contains the next function calls to process
        continue;
      }

      // No more function calls - we have the final answer
      const text = response.text();

      if (text) {
        await writeEvent({
          type: 'answer',
          content: text,
        });
      }

      // Done
      break;
    }

    if (iteration >= MAX_ITERATIONS) {
      await writeEvent({
        type: 'error',
        error: 'Maximum iterations reached. Query too complex.',
      });
    }

    // Send done event
    await writeEvent({ type: 'done' });
  } catch (error: any) {
    console.error('Gemini processing error:', error);
    await writeEvent({
      type: 'error',
      error: error.message || 'Failed to process query',
    });
    await writeEvent({ type: 'done' });
  }
}

// Alternative: Process with explicit thinking (extended reasoning)
// Note: Gemini 2.5 Flash's thinking mode is controlled via generation config
export async function processQueryWithThinking(
  query: string,
  env: Env,
  writer: WritableStreamDefaultWriter<Uint8Array>
): Promise<void> {
  const encoder = new TextEncoder();

  const writeEvent = async (event: StreamEvent) => {
    await writer.write(
      encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
    );
  };

  try {
    const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

    // Use thinking preview model if available
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
      tools: [
        {
          functionDeclarations: convertToolsToGeminiFormat(),
        },
      ],
      systemInstruction: `You are a helpful document assistant. When answering questions:
1. Think step by step about what information you need
2. Use the available tools strategically to find relevant documents
3. Only read files when necessary to answer the question
4. Provide clear, concise answers based on the document content
5. Cite which files you used in your answer`,
    });

    const chat = model.startChat({
      history: [],
    });

    let iteration = 0;
    const MAX_ITERATIONS = 10;

    while (iteration < MAX_ITERATIONS) {
      iteration++;

      await writeEvent({ type: 'thinking', iteration });

      // For thinking mode, we can add explicit reasoning prompts
      const promptWithThinking =
        iteration === 1
          ? `${query}\n\nThink step by step about how to answer this question using the available tools.`
          : query;

      const result = await chat.sendMessage(promptWithThinking);
      const response = result.response;

      // Extract thinking/reasoning if model provides it
      const text = response.text();
      if (text && iteration === 1 && text.includes('step')) {
        await writeEvent({
          type: 'reasoning',
          content: text,
        });
      }

      // Check for function calls
      const functionCalls = response.functionCalls();

      if (functionCalls && functionCalls.length > 0) {
        const functionResponses: any[] = [];

        for (const functionCall of functionCalls) {
          await writeEvent({
            type: 'tool_call',
            tool: functionCall.name,
            input: functionCall.args,
          });

          const toolResult = await executeTool(
            functionCall.name,
            functionCall.args,
            env
          );

          await writeEvent({
            type: 'tool_result',
            tool: functionCall.name,
            result: toolResult.success
              ? JSON.stringify(toolResult.data).substring(0, 200) + '...'
              : toolResult.error || 'Unknown error',
            success: toolResult.success,
          });

          functionResponses.push({
            name: functionCall.name,
            response: toolResult.success
              ? { success: true, data: toolResult.data }
              : { success: false, error: toolResult.error },
          });
        }

        // Send function response
        await chat.sendMessage([
          {
            functionResponse: {
              name: functionResponses[0].name,
              response: functionResponses[0].response,
            },
          } as any,
        ]);

        continue;
      }

      // Final answer
      if (text) {
        await writeEvent({
          type: 'answer',
          content: text,
        });
      }

      break;
    }

    await writeEvent({ type: 'done' });
  } catch (error: any) {
    console.error('Gemini processing error:', error);
    await writeEvent({
      type: 'error',
      error: error.message || 'Failed to process query',
    });
    await writeEvent({ type: 'done' });
  }
}

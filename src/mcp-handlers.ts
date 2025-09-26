import z from "zod";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateOpenAIClient, VECTOR_STORE_ID } from "./openai-client.js";
import { SearchResult, FetchResponse, SessionInfo } from "./types.js";
import { logger } from "./logger.js";

// Session management - simplified for serverless compatibility
const transports: Map<string, StreamableHTTPServerTransport> = new Map();
const sessions: Map<string, SessionInfo> = new Map();

// Only run cleanup in non-serverless environments
if (process.env.NODE_ENV === 'development') {
  // Clean up stale sessions every 5 minutes (only in long-running environments)
  setInterval(() => {
    const now = new Date();
    const staleThreshold = 30 * 60 * 1000; // 30 minutes

    sessions.forEach((session, sessionId) => {
      if (now.getTime() - session.lastActivity.getTime() > staleThreshold) {
        logger.info("Cleaning up stale session", { sessionId });
        cleanupSession(sessionId);
      }
    });
  }, 5 * 60 * 1000);
}

function cleanupSession(sessionId: string): void {
  try {
    const transport = transports.get(sessionId);
    if (transport) {
      transport.close?.();
      transports.delete(sessionId);
    }
    sessions.delete(sessionId);
    logger.debug("Session cleaned up", { sessionId });
  } catch (error) {
    logger.error("Error cleaning up session", {
      sessionId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Handle search tool execution with improved error handling and timeout protection
 */
async function handleSearch(args: {
  query: string;
}): Promise<{ content: any[] }> {
  const { query } = args;
  const startTime = Date.now();

  if (!query || !query.trim()) {
    logger.warn("Empty search query provided");
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ results: [] }),
        },
      ],
    };
  }

  try {
    const openai = validateOpenAIClient();

    if (!VECTOR_STORE_ID) {
      throw new Error("Vector store ID not configured");
    }

    logger.info("Executing vector store search", {
      query: query.substring(0, 100), // Log only first 100 chars
      vectorStoreId: VECTOR_STORE_ID,
    });

    // Add timeout protection for serverless environments
    const searchPromise = openai.vectorStores.search(VECTOR_STORE_ID, {
      query,
      rewrite_query: true,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Search timeout after 25 seconds")),
        25000
      )
    );

    const response = (await Promise.race([
      searchPromise,
      timeoutPromise,
    ])) as any;
    const results: SearchResult[] = [];

    for (let i = 0; i < Math.min(response.data.length, 10); i++) {
      // Limit to 10 results
      const item = response.data[i];

      // Extract text content safely
      const contentList = (item as any).content || [];
      let textContent = "";

      if (Array.isArray(contentList) && contentList.length > 0) {
        const firstContent = contentList[0];
        if (
          typeof firstContent === "object" &&
          firstContent !== null &&
          "text" in firstContent
        ) {
          textContent = String(firstContent.text);
        }
      }

      if (!textContent) {
        textContent = "No content available";
      }

      // Create a snippet from content (shorter for serverless)
      const textSnippet =
        textContent.length > 150
          ? textContent.slice(0, 150) + "..."
          : textContent;

      const result: SearchResult = {
        id: item.file_id || `vs_${i}`,
        title: item.filename || `Document ${i + 1}`,
        text: textSnippet,
        url: item.file_id
          ? `https://platform.openai.com/storage/files/${item.file_id}`
          : undefined,
      };

      results.push(result);
    }

    const duration = Date.now() - startTime;
    logger.info("Search completed successfully", {
      query: query.substring(0, 50),
      resultCount: results.length,
      duration: `${duration}ms`,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ results }),
        },
      ],
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown search error";
    logger.error("Search operation failed", {
      query: query.substring(0, 50),
      error: errorMessage,
      duration: `${duration}ms`,
    });
    throw new Error(`Search failed: ${errorMessage}`);
  }
}

/**
 * Handle fetch tool execution with improved error handling
 */
async function handleFetch(args: { id: string }): Promise<{ content: any[] }> {
  const { id } = args;

  if (!id || !id.trim()) {
    throw new Error("Document ID is required and cannot be empty");
  }

  try {
    const openai = validateOpenAIClient();

    if (!VECTOR_STORE_ID) {
      throw new Error("Vector store ID not configured");
    }

    logger.info("Fetching document content", {
      id,
      vectorStoreId: VECTOR_STORE_ID,
    });

    // Fetch file info and content in parallel
    const [fileInfo, fileContent] = await Promise.all([
      openai.vectorStores.files.retrieve(VECTOR_STORE_ID, id).catch((error) => {
        logger.warn("Could not retrieve file info", {
          id,
          error: error.message,
        });
        return null;
      }),
      openai.files.content(id),
    ]);

    let content = "";

    // Handle different content formats
    if (Array.isArray(fileContent) && fileContent.length > 0) {
      const contentParts: string[] = [];
      for (const contentItem of fileContent) {
        if (
          typeof contentItem === "object" &&
          contentItem !== null &&
          "text" in contentItem
        ) {
          contentParts.push(String((contentItem as any).text));
        }
      }
      content = contentParts.join("\n");
    } else if (typeof fileContent === "string") {
      content = fileContent;
    } else if (Buffer.isBuffer(fileContent)) {
      content = fileContent.toString("utf-8");
    } else {
      content = "No content available";
    }

    // Use filename from fileInfo if available
    const filename =
      fileInfo && (fileInfo as any).filename
        ? String((fileInfo as any).filename)
        : `Document ${id}`;

    const result: FetchResponse = {
      id: id,
      title: filename,
      text: content,
      url: `https://platform.openai.com/storage/files/${id}`,
      metadata:
        fileInfo && (fileInfo as any).attributes
          ? (fileInfo as any).attributes
          : null,
    };

    logger.info("Document fetched successfully", {
      id,
      title: filename,
      contentLength: content.length,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown fetch error";
    logger.error("Fetch operation failed", { id, error: errorMessage });
    throw new Error(`Fetch failed: ${errorMessage}`);
  }
}

/**
 * Create and configure the MCP server with proper schemas
 */
export async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "example-server",
    version: "1.0.0",
  });

  // Define schemas with better validation
  const searchSchema = z.object({
    query: z
      .string()
      .min(2, "Query must be at least 2 characters long")
      .max(500, "Query must be less than 500 characters")
      .describe(
        "Search query string. Natural language queries work best for semantic search."
      ),
  });

  const fetchSchema = z.object({
    id: z
      .string()
      .min(1, "ID cannot be empty")
      .regex(
        /^file-[a-zA-Z0-9]+$/,
        "ID must be a valid OpenAI file ID (file-xxx)"
      )
      .describe("File ID from vector store (file-xxx format)"),
  });

  // Register tools with comprehensive schemas
  server.registerTool(
    "search",
    {
      title: "Search Documents",
      description:
        "Search for documents using OpenAI Vector Store semantic search. Returns a list of relevant documents with snippets.",
      inputSchema: searchSchema.shape,
      outputSchema: z.object({
        results: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            text: z.string(),
            url: z.string().optional(),
          })
        ),
      }).shape,
    },
    handleSearch
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch Document",
      description:
        "Fetch complete document content by file ID from the vector store.",
      inputSchema: fetchSchema.shape,
      outputSchema: z.object({
        id: z.string(),
        title: z.string(),
        text: z.string(),
        url: z.string(),
        metadata: z.any().nullable(),
      }).shape,
    },
    handleFetch
  );

  logger.info("MCP server created and tools registered");
  return server;
}

export function getOrCreateTransport(
  sessionId?: string,
  requestBody?: any
): StreamableHTTPServerTransport | null {
  try {
    logger.debug("Transport request", {
      sessionId,
      hasBody: !!requestBody,
      isVercel: !!process.env.VERCEL,
    });

    // Handle existing session
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId);
      const session = sessions.get(sessionId);

      if (transport && session) {
        // Update activity timestamp
        session.lastActivity = new Date();
        logger.debug("Reusing existing transport", { sessionId });
        return transport;
      } else {
        // Clean up invalid session
        logger.warn("Found invalid session, cleaning up", { sessionId });
        cleanupSession(sessionId);
      }
    }

    // Handle new initialization request
    if (!sessionId && requestBody && isInitializeRequest(requestBody)) {
      logger.info("Creating new MCP transport for initialization", {
        method: requestBody.method,
        isVercel: !!process.env.VERCEL,
      });

      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            logger.info("MCP session initialized", {
              sessionId: newSessionId,
              transport: "created",
            });

            // Store the transport and session info
            transports.set(newSessionId, transport);
            sessions.set(newSessionId, {
              id: newSessionId,
              createdAt: new Date(),
              lastActivity: new Date(),
            });
          },
        });

        // Set up cleanup handler (Not reliable in serverless)
        transport.onclose = () => {
          if (transport.sessionId) {
            logger.info("Transport closed, cleaning up session", {
              sessionId: transport.sessionId,
            });
            cleanupSession(transport.sessionId);
          }
        };

        // In serverless environments, clean up old sessions immediately to free memory
        if (process.env.VERCEL) {
          cleanupOldSessions();
        }

        logger.debug("Transport created successfully");
        return transport;
      } catch (error) {
        logger.error("Failed to create transport", {
          error: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
        });
        return null;
      }
    }

    // Log what we received for debugging
    logger.warn("Cannot create or find transport", {
      hasSessionId: !!sessionId,
      sessionExists: sessionId ? transports.has(sessionId) : false,
      hasRequestBody: !!requestBody,
      isInitRequest: requestBody ? isInitializeRequest(requestBody) : false,
      requestMethod: requestBody?.method,
    });

    return null;
  } catch (error) {
    logger.error("Error in getOrCreateTransport", {
      sessionId,
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  }
}

// Helper function to clean up old sessions in serverless environments
function cleanupOldSessions(): void {
  if (sessions.size > 10) {
    // Keep max 10 sessions in serverless
    const now = new Date();
    const sessionsToCleanup: string[] = [];

    sessions.forEach((session, sessionId) => {
      const ageMinutes =
        (now.getTime() - session.lastActivity.getTime()) / (1000 * 60);
      if (ageMinutes > 10) {
        // Cleanup sessions older than 10 minutes
        sessionsToCleanup.push(sessionId);
      }
    });

    sessionsToCleanup.forEach(cleanupSession);

    if (sessionsToCleanup.length > 0) {
      logger.info("Cleaned up old sessions", {
        count: sessionsToCleanup.length,
        remaining: sessions.size,
      });
    }
  }
}

export function getSessionStats() {
  return {
    activeSessions: sessions.size,
    activeTransports: transports.size,
    sessions: Array.from(sessions.values()).map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastActivity: session.lastActivity,
      ageMinutes: Math.round(
        (new Date().getTime() - session.createdAt.getTime()) / (1000 * 60)
      ),
    })),
  };
}

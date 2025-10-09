import z from "zod";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateOpenAIClient, VECTOR_STORE_ID } from "./openai-client.js";
import { SearchResult, FetchResponse, SessionInfo } from "./types.js";
import { logger } from "./logger.js";
import { SessionService } from "./session-service.js";

// In-memory transport cache for active connections (lightweight)
const transports: Map<string, StreamableHTTPServerTransport> = new Map();

// Database-backed session cleanup with configurable intervals
const SESSION_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const SESSION_EXPIRY_TIME = parseInt(
  process.env.SESSION_EXPIRY_MINUTES || "120",
  10
); // Default 2 hours

setInterval(async () => {
  try {
    const cleanedCount = await SessionService.cleanupExpiredSessions(
      SESSION_EXPIRY_TIME
    );
    if (cleanedCount > 0) {
      logger.info("Database session cleanup completed", {
        cleanedCount,
        expiryMinutes: SESSION_EXPIRY_TIME,
      });
    }
  } catch (error) {
    logger.error("Database session cleanup failed", { error });
  }
}, SESSION_CLEANUP_INTERVAL);

logger.info("Database-backed session management enabled for EC2 environment");

async function cleanupSession(sessionId: string): Promise<void> {
  try {
    // Close transport if exists
    const transport = transports.get(sessionId);
    if (transport) {
      transport.close?.();
      transports.delete(sessionId);
    }

    // Deactivate session in database
    await SessionService.deactivateSession(sessionId);

    logger.info("Session cleaned up", { sessionId });
  } catch (error) {
    logger.error("Failed to cleanup session", { sessionId, error });
  }
}

/**
 * Handle search tool execution with improved error handling
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

    // EC2 can handle longer operations
    const response = await openai.vectorStores.search(VECTOR_STORE_ID, {
      query,
      rewrite_query: true,
    });

    const results: SearchResult[] = [];

    // Return more results for EC2 (not limited like serverless)
    for (let i = 0; i < Math.min(response.data.length, 20); i++) {
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

      // Longer snippets for EC2 environment
      const textSnippet =
        textContent.length > 300
          ? textContent.slice(0, 300) + "..."
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

export async function getOrCreateTransport(
  sessionId?: string,
  requestBody?: any
): Promise<StreamableHTTPServerTransport | null> {
  try {
    logger.debug("Transport request", {
      sessionId,
      hasBody: !!requestBody,
      method: requestBody?.method,
      environment: "EC2",
    });

    // Handle existing session (EC2 supports session reuse)
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId);
      const session = await SessionService.getSession(sessionId);

      if (transport && session && session.status === "active") {
        // Session activity is automatically updated in getSession
        logger.debug("Reusing existing transport", { sessionId });
        return transport;
      } else {
        // Clean up invalid session
        logger.warn("Found invalid session, cleaning up", { sessionId });
        await cleanupSession(sessionId);
      }
    }

    // Handle new initialization request
    if (!sessionId && requestBody && isInitializeRequest(requestBody)) {
      logger.info("Creating new MCP transport for initialization", {
        method: requestBody.method,
        environment: "EC2",
      });

      try {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: async (newSessionId) => {
            logger.info("MCP session initialized", {
              sessionId: newSessionId,
              transport: "created",
            });

            // Store the transport in memory for quick access
            transports.set(newSessionId, transport);

            // Create session in database
            await SessionService.createSession(newSessionId, {
              transportType: "http",
              userAgent: "mcp-client", // Default since headers not available in MCP request body
            });

            // Save transport state in database
            await SessionService.saveTransportState(newSessionId, "http", {
              created: new Date().toISOString(),
            });
          },
        });

        // Set up cleanup handler
        transport.onclose = async () => {
          if (transport.sessionId) {
            logger.info("Transport closed, cleaning up session", {
              sessionId: transport.sessionId,
            });
            await cleanupSession(transport.sessionId);
          }
        };

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

export async function getSessionStats() {
  try {
    const dbStats = await SessionService.getSessionStats();
    return {
      activeSessions: dbStats.active,
      totalSessions: dbStats.total,
      inactiveSessions: dbStats.inactive,
      expiredSessions: dbStats.expired,
      activeTransports: transports.size,
      database: dbStats,
    };
  } catch (error) {
    logger.error("Failed to get session stats", { error });
    return {
      activeSessions: 0,
      totalSessions: 0,
      inactiveSessions: 0,
      expiredSessions: 0,
      activeTransports: transports.size,
      database: { total: 0, active: 0, inactive: 0, expired: 0 },
      error: "Database unavailable",
    };
  }
}

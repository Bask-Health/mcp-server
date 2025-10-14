import z from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateOpenAIClient, VECTOR_STORE_ID } from "./openai-client.js";
import { SearchResult, FetchResponse } from "./types.js";
import { logger } from "./logger.js";

/**
 * Handle search tool execution
 */
export async function handleSearch(args: {
  query: string;
}): Promise<{ content: any[] }> {
  const { query } = args;

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
      query: query.substring(0, 100),
      vectorStoreId: VECTOR_STORE_ID,
    });

    const response = await openai.vectorStores.search(VECTOR_STORE_ID, {
      query,
      rewrite_query: true,
    });

    const results: SearchResult[] = [];

    for (let i = 0; i < Math.min(response.data.length, 20); i++) {
      // Limit to 20 results
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

      // Create a snippet from content
      const textSnippet =
        textContent.length > 300
          ? textContent.slice(0, 300) + "..."
          : textContent;

      const result: SearchResult = {
        id: item.file_id || `vs_${i}`,
        title: item.filename || `Document ${i + 1}`,
        text: textSnippet,
        url: `https://platform.openai.com/storage/files/${item.file_id}`,
      };

      results.push(result);
    }

    logger.info("Search completed successfully", {
      query: query.substring(0, 50),
      resultCount: results.length,
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
    const errorMessage =
      error instanceof Error ? error.message : "Unknown search error";
    logger.error("Search operation failed", {
      query: query.substring(0, 50),
      error: errorMessage,
    });
    throw new Error(`Search failed: ${errorMessage}`);
  }
}

/**
 * Handle fetch tool execution
 */
export async function handleFetch(args: {
  id: string;
}): Promise<{ content: any[] }> {
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
export function createMcpServer(): McpServer {
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

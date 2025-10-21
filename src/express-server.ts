import express from "express";
import helmet from "helmet";
import cors from "cors";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { mcpAuthMiddleware, errorHandler } from "./middleware.js";
import { vectorStoreUpdater } from "./webhookHandler.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-handlers.js";

// Initialize single MCP server and transport (stateless)
const mcpServer = createMcpServer();
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // stateless server
});

// Connect server to transport once at startup
let serverConnected = false;
const connectServer = async () => {
  if (!serverConnected) {
    try {
      await mcpServer.connect(transport);
      logger.info("MCP server connected to transport successfully");
      serverConnected = true;
    } catch (error) {
      logger.error("Failed to connect MCP server to transport", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }
};

export function createExpressApp(): express.Application {
  const app = express();

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: false, // Disable CSP for API usage
    })
  );

  app.use(
    cors({
      origin: config.api.corsOrigin,
      methods: ["GET", "POST", "DELETE"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "MCP-Session-Id",
        "mcp-session-id",
        "mcp-protocol-version",
      ],
      credentials: true,
    })
  );

  app.disable("x-powered-by");

  // Request timeout middleware to prevent hanging requests
  app.use((req, res, next) => {
    // Set a 30-second timeout for all requests
    req.setTimeout(30000, () => {
      logger.warn("Request timeout", {
        url: req.url,
        method: req.method,
        ip: req.ip,
      });
      if (!res.headersSent) {
        res.status(408).json({
          error: "Request timeout",
          message: "The request took too long to process",
        });
      }
    });

    res.setTimeout(30000, () => {
      logger.warn("Response timeout", {
        url: req.url,
        method: req.method,
        ip: req.ip,
      });
    });

    next();
  });

  // Request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();

    logger.info("Incoming request", {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      contentType: req.headers["content-type"],
    });

    // Log response when finished
    res.on("finish", () => {
      const duration = Date.now() - start;
      logger.info("Request completed", {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
      });
    });

    next();
  });

  // Body parsing middleware
  app.use(express.json({ limit: "10mb" }));
  app.use(express.raw({ type: "application/json", limit: "10mb" }));

  // Health check endpoint for Docker and load balancer
  app.get("/health", (req, res) => {
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || "1.0.0",
      environment: config.environment.nodeEnv,
      memory: process.memoryUsage(),
    });
  });

  // Root endpoint - basic API info
  app.get("/", (req, res) => {
    logger.info("Root endpoint accessed", { ip: req.ip });
    res.json({
      name: "MCP Server",
      version: "1.0.0",
      description:
        "Model Context Protocol Server with OpenAI Vector Store integration",
      status: "running",
      timestamp: new Date().toISOString(),
      environment: config.environment.nodeEnv,
      deployment: process.env.VERCEL ? "vercel" : "local",
      endpoints: {
        health: "/health",
        mcp: "/mcp (POST, GET, DELETE)",
        webhook: "/webhook (POST)",
        stats: "/stats (GET, requires auth)",
      },
    });
  });

  // GET /mcp - Method not allowed (OpenAI MCP uses POST only)
  app.get("/mcp", mcpAuthMiddleware, (req, res) => {
    logger.info("GET /mcp request received (method not allowed)", {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed. Use POST /mcp for MCP requests.",
      },
      id: null,
    });
  });

  // POST /mcp - Handle MCP messages (stateless HTTP transport)
  app.post("/mcp", mcpAuthMiddleware, async (req, res) => {
    logger.info("POST /mcp request received", {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      bodyPreview: JSON.stringify(req.body).substring(0, 200),
    });

    try {
      // Use the single stateless transport instance
      await transport.handleRequest(req, res, req.body);
      logger.info("POST /mcp request handled successfully");
    } catch (error) {
      logger.error("Error handling POST /mcp request", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
            data: error instanceof Error ? error.message : "Unknown error",
          },
          id: null,
        });
      }
    }
  });

  // DELETE /mcp - Method not allowed
  app.delete("/mcp", mcpAuthMiddleware, (req, res) => {
    logger.info("DELETE /mcp request received (method not allowed)", {
      ip: req.ip,
    });
    res.status(405).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed",
      },
      id: null,
    });
  });

  // Webhook endpoint for repository updates
  app.post(
    "/webhook",
    (req, res) => {
      try {
        vectorStoreUpdater.handleWebhook(req, res);
      } catch (error) {
        logger.error("Webhook handler error", {
          error: error instanceof Error ? error.message : "Unknown error",
          ip: req.ip,
        });

        if (!res.headersSent) {
          res.status(500).json({ error: "Webhook processing failed" });
        }
      }
    }
  );

  // Handle 404 errors
  app.use("*", (req, res) => {
    logger.warn("404 Not Found", {
      url: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // Ensure response is always sent
    if (!res.headersSent) {
      res.status(404).json({
        error: "Endpoint not found",
        message: `The endpoint '${req.method} ${req.originalUrl}' was not found on this server`,
        availableEndpoints: {
          root: "GET /",
          health: "GET /health",
          mcp: "POST|GET|DELETE /mcp",
          webhook: "POST /webhook",
          stats: "GET /stats (requires auth)",
        },
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}

// Export connectServer for startup initialization
export { connectServer };

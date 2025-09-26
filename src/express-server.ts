import express from "express";
import helmet from "helmet";
import cors from "cors";
import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  mcpAuthMiddleware,
  validateRequestBody,
  errorHandler,
} from "./middleware.js";
import {
  createMcpServer,
  getOrCreateTransport,
  getSessionStats,
} from "./mcp-handlers.js";
import { vectorStoreUpdater } from "./webhookHandler.js";

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

  // Health check endpoint
  app.get("/health", (req, res) => {
    logger.info("Health check accessed", { ip: req.ip });
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: config.environment.nodeEnv,
    });
  });

  // Session stats endpoint (for debugging)
  app.get("/stats", mcpAuthMiddleware, (req, res) => {
    try {
      const stats = getSessionStats();
      res.json(stats);
    } catch (error) {
      logger.error("Error getting session stats", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
      res.status(500).json({ error: "Failed to get session stats" });
    }
  });

  // Main MCP endpoint
  app.post("/mcp", mcpAuthMiddleware, validateRequestBody, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      const transport = getOrCreateTransport(sessionId, req.body);

      if (!transport) {
        logger.warn("Failed to get or create transport", {
          sessionId,
          method: req.body?.method,
          ip: req.ip,
        });

        return res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message:
              "Unable to establish MCP session. Ensure this is a valid initialize request or provide a valid session ID.",
          },
          id: req.body?.id || null,
        });
      }

      // Connect server to transport if needed
      if (
        !transport.sessionId &&
        req.body &&
        req.body.method === "initialize"
      ) {
        const server = await createMcpServer();
        await server.connect(transport);
        logger.info("MCP server connected to new transport");
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      logger.error("MCP request handling error", {
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        sessionId: req.headers["mcp-session-id"],
        method: req.body?.method,
        ip: req.ip,
      });

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error during MCP request processing",
          },
          id: req.body?.id || null,
        });
      }
    }
  });

  // Handle GET requests for server-to-client notifications via SSE
  app.get("/mcp", mcpAuthMiddleware, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (!sessionId) {
        logger.warn("GET /mcp request missing session ID", { ip: req.ip });
        return res.status(400).json({
          error: "Session ID required for SSE connection",
        });
      }

      const transport = getOrCreateTransport(sessionId);
      if (!transport) {
        logger.warn("GET /mcp request with invalid session ID", {
          sessionId,
          ip: req.ip,
        });
        return res.status(404).json({
          error: "Session not found",
        });
      }

      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error("MCP GET request error", {
        error: error instanceof Error ? error.message : "Unknown error",
        sessionId: req.headers["mcp-session-id"],
        ip: req.ip,
      });

      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Handle DELETE requests for session termination
  app.delete("/mcp", mcpAuthMiddleware, async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (!sessionId) {
        logger.warn("DELETE /mcp request missing session ID", { ip: req.ip });
        return res.status(400).json({
          error: "Session ID required for session termination",
        });
      }

      const transport = getOrCreateTransport(sessionId);
      if (!transport) {
        logger.warn("DELETE /mcp request with invalid session ID", {
          sessionId,
          ip: req.ip,
        });
        // Return success even if session doesn't exist (idempotent)
        return res.status(200).json({ message: "Session terminated" });
      }

      await transport.handleRequest(req, res);
      logger.info("MCP session terminated via DELETE", { sessionId });
    } catch (error) {
      logger.error("MCP DELETE request error", {
        error: error instanceof Error ? error.message : "Unknown error",
        sessionId: req.headers["mcp-session-id"],
        ip: req.ip,
      });

      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Webhook endpoint for repository updates
  app.post(
    "/webhook",
    express.raw({ type: "application/json" }),
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

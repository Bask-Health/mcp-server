import express from "express";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { McpResponse } from "./types.js";

export function mcpAuthMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  try {
    // Validate MCP protocol version
    const protocolVersion = req.headers["mcp-protocol-version"] as string;
    if (!protocolVersion) {
      logger.warn("Missing mcp-protocol-version header", {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        url: req.url,
      });
      respondWithError(res, 400, -32600, "Missing mcp-protocol-version header");
      return;
    }

    if (protocolVersion !== "2024-11-05") {
      logger.warn("Invalid mcp-protocol-version", {
        version: protocolVersion,
        ip: req.ip,
        url: req.url,
      });
      respondWithError(
        res,
        400,
        -32600,
        `Invalid mcp-protocol-version: ${protocolVersion}. Expected: 2024-11-05`
      );
      return;
    }

    // Validate Authorization header
    const authHeader = req.headers["authorization"] as string;
    if (!authHeader) {
      logger.warn("Missing Authorization header", {
        ip: req.ip,
        url: req.url,
        headers: Object.keys(req.headers),
      });
      respondWithError(res, 401, -32003, "Missing Authorization header");
      return;
    }

    if (!authHeader.startsWith("Bearer ")) {
      logger.warn("Invalid Authorization header format", {
        ip: req.ip,
        authHeader: authHeader.substring(0, 20) + "...",
      });
      respondWithError(
        res,
        401,
        -32003,
        "Authorization header must use Bearer token"
      );
      return;
    }

    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      logger.warn("Empty bearer token", { ip: req.ip });
      respondWithError(res, 401, -32003, "Empty bearer token");
      return;
    }

    if (token !== config.api.key) {
      logger.warn("Invalid API key", {
        ip: req.ip,
        tokenPrefix: token.substring(0, 8) + "...",
      });
      respondWithError(res, 401, -32003, "Invalid API key");
      return;
    }

    // Add token to request for downstream use
    (req as any).accessToken = token;

    logger.debug("MCP authentication successful", {
      ip: req.ip,
      protocolVersion,
      url: req.url,
    });

    next();
  } catch (error) {
    logger.error("MCP auth middleware error", {
      error: error instanceof Error ? error.message : "Unknown error",
      ip: req.ip,
      url: req.url,
    });
    respondWithError(res, 500, -32603, "Internal authentication error");
  }
}

export function errorHandler(
  error: Error,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  logger.error("Unhandled express error", {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

  if (res.headersSent) {
    return next(error);
  }

  respondWithError(res, 500, -32603, "Internal server error");
}

function respondWithError(
  res: express.Response,
  statusCode: number,
  rpcCode: number,
  message: string,
  id: string | number | null = null
): void {
  const response: McpResponse = {
    jsonrpc: "2.0",
    error: {
      code: rpcCode,
      message: message,
    },
    id: id,
  };

  res.status(statusCode).json(response);
}

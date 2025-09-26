import { config } from "./config.js";
import { logger } from "./logger.js";
import { createExpressApp } from "./express-server.js";

// Re-export for backward compatibility with webhookHandler
export { logger };
export { openaiClient, VECTOR_STORE_ID } from "./openai-client.js";

// Create the Express app for Vercel (serverless) or local development
const app = createExpressApp();

// Export the app as default for Vercel
export default app;

/**
 * Main application entry point for local development
 * Only runs when this file is executed directly (not imported)
 */
async function main(): Promise<void> {
  try {
    logger.info("Starting MCP server application", {
      nodeEnv: config.environment.nodeEnv,
      port: config.api.port,
      corsOrigin: config.api.corsOrigin,
    });

    // Start the server (only for local development)
    const server = app.listen(config.api.port, () => {
      logger.info(`🚀 Server listening on port ${config.api.port}`, {
        environment: config.environment.nodeEnv,
        urls: [
          `http://localhost:${config.api.port}`,
          `http://127.0.0.1:${config.api.port}`,
        ],
      });
    });

    // Graceful shutdown handling
    const shutdown = () => {
      logger.info("Received shutdown signal, closing server gracefully");
      server.close(() => {
        logger.info("Server closed successfully");
        process.exit(0);
      });
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (error) {
    logger.error("Failed to start server", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error("Unhandled error in main", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    process.exit(1);
  });
}

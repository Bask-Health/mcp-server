import { config } from "./config.js";
import { logger } from "./logger.js";
import { createExpressApp } from "./express-server.js";

// Re-export for backward compatibility with webhookHandler
export { logger };
export { openaiClient, VECTOR_STORE_ID } from "./openai-client.js";

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    logger.info("Starting MCP server application", {
      nodeEnv: config.environment.nodeEnv,
      port: config.api.port,
      corsOrigin: config.api.corsOrigin,
    });

    // Create and configure the Express application
    const app = createExpressApp();

    // Start the server
    const server = app.listen(config.api.port, () => {
      logger.info(`Server listening on port ${config.api.port}`, {
        environment: config.environment.nodeEnv,
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

// Start the application
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    logger.error("Unhandled error in main", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    process.exit(1);
  });
}

export default createExpressApp;

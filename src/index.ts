import { config } from "./config.js";
import { logger } from "./logger.js";
import { createExpressApp } from "./express-server.js";

// Re-export for backward compatibility with webhookHandler
export { logger };
export { openaiClient, VECTOR_STORE_ID } from "./openai-client.js";


const app = createExpressApp();

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    logger.info("Server started successfully", {
      environment: config.environment.nodeEnv,
      transport: "stdio + http",
      httpPort: config.api.port,
    });
    const server = app.listen(config.api.port, () => {
      logger.info(`Server listening on port ${config.api.port}`, {
        urls: [
          `http://localhost:${config.api.port}`,
          `http://127.0.0.1:${config.api.port}`,
        ],
      });
    });

    // Graceful shutdown handling
    const shutdown = async () => {
      logger.info("Received shutdown signal, closing servers gracefully");

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

main().catch((error) => {
  logger.error("Unhandled error in main", {
    error: error instanceof Error ? error.message : "Unknown error",
  });
  process.exit(1);
});

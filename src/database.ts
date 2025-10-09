import { PrismaClient } from "../generated/prisma_client/index.js";
import { logger } from "./logger.js";
import { config } from "./config.js";

// Singleton pattern for Prisma client
let prisma: PrismaClient;

/**
 * Get or create Prisma client instance
 */
export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    // Use the database URL from config (which handles SST Resource automatically)
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: config.database.url,
        },
      },
    });
  }

  return prisma;
}

/**
 * Close database connection
 */
export async function closeDatabaseConnection(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    logger.info("Database connection closed");
  }
}

/**
 * Test database connection
 */
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const client = getPrismaClient();
    await client.$queryRaw`SELECT 1`;
    logger.info("Database connection test successful");
    return true;
  } catch (error) {
    logger.error("Database connection test failed", { error });
    return false;
  }
}

// Export Prisma client instance
export const db = getPrismaClient();

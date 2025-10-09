import { db } from "./database.js";
import { logger } from "./logger.js";
import { randomUUID } from "node:crypto";

export interface SessionData {
  id: string;
  sessionId: string;
  createdAt: Date;
  lastActivity: Date;
  status: "active" | "inactive" | "expired";
  metadata?: any;
}

export interface TransportData {
  id: string;
  sessionId: string;
  transportType: string;
  state?: any;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Session service for managing MCP sessions in the database
 */
export class SessionService {
  /**
   * Create a new session
   */
  static async createSession(
    sessionId?: string,
    metadata?: any
  ): Promise<SessionData> {
    const id = sessionId || randomUUID();

    try {
      const session = await db.session.create({
        data: {
          sessionId: id,
          status: "active",
          metadata: metadata || {},
        },
      });

      logger.info("Session created", { sessionId: id });
      return session as SessionData;
    } catch (error) {
      logger.error("Failed to create session", { sessionId: id, error });
      throw new Error(`Failed to create session: ${error}`);
    }
  }

  /**
   * Get session by ID
   */
  static async getSession(sessionId: string): Promise<SessionData | null> {
    try {
      const session = await db.session.findUnique({
        where: { sessionId },
        include: { transport: true },
      });

      if (session) {
        // Update last activity
        await this.updateSessionActivity(sessionId);
      }

      return session as SessionData;
    } catch (error) {
      logger.error("Failed to get session", { sessionId, error });
      return null;
    }
  }

  /**
   * Update session activity timestamp
   */
  static async updateSessionActivity(sessionId: string): Promise<void> {
    try {
      await db.session.update({
        where: { sessionId },
        data: { lastActivity: new Date() },
      });
    } catch (error) {
      logger.error("Failed to update session activity", { sessionId, error });
    }
  }

  /**
   * Update session metadata
   */
  static async updateSessionMetadata(
    sessionId: string,
    metadata: any
  ): Promise<void> {
    try {
      await db.session.update({
        where: { sessionId },
        data: { metadata },
      });

      logger.debug("Session metadata updated", { sessionId });
    } catch (error) {
      logger.error("Failed to update session metadata", { sessionId, error });
    }
  }

  /**
   * Mark session as inactive
   */
  static async deactivateSession(sessionId: string): Promise<void> {
    try {
      await db.session.update({
        where: { sessionId },
        data: { status: "inactive" },
      });

      logger.info("Session deactivated", { sessionId });
    } catch (error) {
      logger.error("Failed to deactivate session", { sessionId, error });
    }
  }

  /**
   * Delete session and related data
   */
  static async deleteSession(sessionId: string): Promise<void> {
    try {
      await db.session.delete({
        where: { sessionId },
      });

      logger.info("Session deleted", { sessionId });
    } catch (error) {
      logger.error("Failed to delete session", { sessionId, error });
    }
  }

  /**
   * Clean up expired sessions (configurable expiry time)
   */
  static async cleanupExpiredSessions(
    maxAgeMinutes: number = 120
  ): Promise<number> {
    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    try {
      // Only cleanup inactive sessions or very old ones
      const result = await db.session.deleteMany({
        where: {
          OR: [
            // Inactive sessions older than 30 minutes
            {
              AND: [
                { status: "inactive" },
                { lastActivity: { lt: new Date(Date.now() - 30 * 60 * 1000) } },
              ],
            },
            // Any session older than maxAgeMinutes
            { lastActivity: { lt: cutoffTime } },
            // Explicitly expired sessions
            { status: "expired" },
          ],
        },
      });

      if (result.count > 0) {
        logger.info("Cleaned up expired sessions", {
          count: result.count,
          maxAgeMinutes,
          cutoffTime: cutoffTime.toISOString(),
        });
      }

      return result.count;
    } catch (error) {
      logger.error("Failed to cleanup expired sessions", { error });
      return 0;
    }
  }

  /**
   * Get session statistics
   */
  static async getSessionStats(): Promise<{
    total: number;
    active: number;
    inactive: number;
    expired: number;
  }> {
    try {
      const [total, active, inactive, expired] = await Promise.all([
        db.session.count(),
        db.session.count({ where: { status: "active" } }),
        db.session.count({ where: { status: "inactive" } }),
        db.session.count({ where: { status: "expired" } }),
      ]);

      return { total, active, inactive, expired };
    } catch (error) {
      logger.error("Failed to get session stats", { error });
      return { total: 0, active: 0, inactive: 0, expired: 0 };
    }
  }

  /**
   * Create or update transport state for a session
   */
  static async saveTransportState(
    sessionId: string,
    transportType: string = "http",
    state?: any
  ): Promise<TransportData> {
    try {
      const transport = await db.transport.upsert({
        where: { sessionId },
        update: {
          transportType,
          state: state || {},
          updatedAt: new Date(),
        },
        create: {
          sessionId,
          transportType,
          state: state || {},
        },
      });

      logger.debug("Transport state saved", { sessionId, transportType });
      return transport;
    } catch (error) {
      logger.error("Failed to save transport state", { sessionId, error });
      throw new Error(`Failed to save transport state: ${error}`);
    }
  }

  /**
   * Get transport state for a session
   */
  static async getTransportState(
    sessionId: string
  ): Promise<TransportData | null> {
    try {
      const transport = await db.transport.findUnique({
        where: { sessionId },
      });

      return transport;
    } catch (error) {
      logger.error("Failed to get transport state", { sessionId, error });
      return null;
    }
  }

  /**
   * Delete transport state for a session
   */
  static async deleteTransportState(sessionId: string): Promise<void> {
    try {
      await db.transport.delete({
        where: { sessionId },
      });

      logger.debug("Transport state deleted", { sessionId });
    } catch (error) {
      logger.error("Failed to delete transport state", { sessionId, error });
    }
  }

  /**
   * Log tool usage
   */
  static async logToolUsage(
    sessionId: string | null,
    toolName: string,
    operation: string,
    options: {
      duration?: number;
      success?: boolean;
      errorMessage?: string;
      requestSize?: number;
      responseSize?: number;
    } = {}
  ): Promise<void> {
    try {
      await db.toolUsage.create({
        data: {
          sessionId,
          toolName,
          operation,
          duration: options.duration,
          success: options.success ?? true,
          errorMessage: options.errorMessage,
          requestSize: options.requestSize,
          responseSize: options.responseSize,
        },
      });

      logger.debug("Tool usage logged", { sessionId, toolName, operation });
    } catch (error) {
      logger.error("Failed to log tool usage", {
        sessionId,
        toolName,
        operation,
        error,
      });
    }
  }

  /**
   * Clean up old tool usage logs (keep last 30 days)
   */
  static async cleanupOldLogs(retentionDays: number = 30): Promise<number> {
    const cutoffTime = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000
    );

    try {
      const [sessionLogs, toolLogs] = await Promise.all([
        db.sessionLog.deleteMany({
          where: { createdAt: { lt: cutoffTime } },
        }),
        db.toolUsage.deleteMany({
          where: { createdAt: { lt: cutoffTime } },
        }),
      ]);

      const totalCleaned = sessionLogs.count + toolLogs.count;
      if (totalCleaned > 0) {
        logger.info("Cleaned up old logs", {
          sessionLogs: sessionLogs.count,
          toolLogs: toolLogs.count,
          retentionDays,
        });
      }

      return totalCleaned;
    } catch (error) {
      logger.error("Failed to cleanup old logs", { error });
      return 0;
    }
  }

  /**
   * Add session log entry
   */
  static async addSessionLog(
    sessionId: string,
    level: "info" | "warn" | "error" | "debug",
    message: string,
    metadata?: any
  ): Promise<void> {
    try {
      await db.sessionLog.create({
        data: {
          sessionId,
          level,
          message,
          metadata: metadata || {},
        },
      });
    } catch (error) {
      logger.error("Failed to add session log", {
        sessionId,
        level,
        message,
        error,
      });
    }
  }
}

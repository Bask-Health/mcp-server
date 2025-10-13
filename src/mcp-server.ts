import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse";
import { createMcpServer } from "./mcp-handlers";

export const transports: { [sessionId: string]: SSEServerTransport } = {};
export const mcpServer = createMcpServer();

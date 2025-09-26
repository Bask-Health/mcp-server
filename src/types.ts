export interface SearchResult {
  id: string;
  title: string;
  text: string;
  url?: string;
}

export interface FetchResponse {
  id: string;
  title: string;
  text: string;
  url?: string;
  metadata?: any;
}

export interface McpError {
  code: number;
  message: string;
  data?: any;
}

export interface McpRequest {
  jsonrpc: string;
  method: string;
  params?: any;
  id?: string | number | null;
}

export interface McpResponse {
  jsonrpc: string;
  id?: string | number | null;
  result?: any;
  error?: McpError;
}

export interface SessionInfo {
  id: string;
  createdAt: Date;
  lastActivity: Date;
}

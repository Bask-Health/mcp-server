import * as dotenv from "dotenv";

dotenv.config();

export interface Config {
  api: {
    key: string;
    port: number;
    corsOrigin: string;
  };
  openai: {
    apiKey: string;
    vectorStoreId: string;
  };
  database: {
    url: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    name?: string;
  };
  github: {
    webhookSecret?: string;
  };
  environment: {
    nodeEnv: string;
    isDevelopment: boolean;
    isProduction: boolean;
    isSST: boolean;
  };
}

function validateEnvVar(
  name: string,
  value: string | undefined,
  defaultValue?: string
): string {
  if (!value && !defaultValue) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value || defaultValue!;
}

function getDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return process.env.DATABASE_URL;
}

export const config: Config = {
  api: {
    key: validateEnvVar("API_KEY", process.env.API_KEY, "default-api-key"),
    port: parseInt(process.env.PORT || "8000", 10),
    corsOrigin: process.env.CORS_ORIGIN || "*",
  },
  openai: {
    apiKey: validateEnvVar("OPENAI_API_KEY", process.env.OPENAI_API_KEY, ""),
    vectorStoreId: process.env.VECTOR_STORE_ID || "",
  },
  database: {
    url: getDatabaseUrl(),
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,
  },
  github: {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  },
  environment: {
    nodeEnv: process.env.NODE_ENV || "development",
    isDevelopment: process.env.NODE_ENV !== "production",
    isProduction: process.env.NODE_ENV === "production",
    isSST: !!process.env.SST_STAGE,
  },
};

export default config;

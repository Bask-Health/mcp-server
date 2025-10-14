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

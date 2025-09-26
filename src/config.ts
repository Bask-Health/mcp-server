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
  environment: {
    nodeEnv: string;
    isDevelopment: boolean;
    isProduction: boolean;
  };
}

function validateEnvVar(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config: Config = {
  api: {
    key: validateEnvVar("API_KEY", process.env.API_KEY),
    port: parseInt(process.env.PORT || "3000", 10),
    corsOrigin: process.env.CORS_ORIGIN || "*",
  },
  openai: {
    apiKey: validateEnvVar("OPENAI_API_KEY", process.env.OPENAI_API_KEY),
    vectorStoreId: process.env.VECTOR_STORE_ID || "",
  },
  environment: {
    nodeEnv: process.env.NODE_ENV || "development",
    isDevelopment: process.env.NODE_ENV !== "production",
    isProduction: process.env.NODE_ENV === "production",
  },
};

export default config;

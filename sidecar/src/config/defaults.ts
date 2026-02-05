import { ConfigSchema, type AppConfig } from "./schema";
import { getDefaultInterface } from "../network/interfaces";

export const defaultConfig: AppConfig = ConfigSchema.parse({});

export function getDefaultHost(): string {
  const defaultInterface = getDefaultInterface();
  return defaultInterface?.address ?? "127.0.0.1";
}

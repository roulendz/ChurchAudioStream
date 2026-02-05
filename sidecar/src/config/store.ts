import fs from "node:fs";
import path from "node:path";
import { ConfigSchema, type AppConfig } from "./schema";
import { defaultConfig } from "./defaults";
import { logger } from "../utils/logger";

interface ConfigUpdateResult {
  success: boolean;
  config: AppConfig;
  errors?: string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      ) as T[keyof T];
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue as T[keyof T];
    }
  }

  return result;
}

export class ConfigStore {
  private config: AppConfig;
  private readonly configFilePath: string;

  constructor(basePath: string) {
    this.configFilePath = path.join(path.resolve(basePath), "config.json");
    this.config = this.load();
  }

  private load(): AppConfig {
    try {
      const rawContent = fs.readFileSync(this.configFilePath, "utf-8");
      const parsedJson = JSON.parse(rawContent);
      const validationResult = ConfigSchema.safeParse(parsedJson);

      if (validationResult.success) {
        logger.info("Config loaded from disk", { path: this.configFilePath });
        return validationResult.data;
      }

      const issueMessages = validationResult.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      logger.warn("Invalid config file, resetting to defaults", {
        path: this.configFilePath,
        issues: issueMessages.join("; "),
      });
      this.save(defaultConfig);
      return structuredClone(defaultConfig);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.warn("Cannot read config file, using defaults", {
        path: this.configFilePath,
        error: errorMessage,
      });
      this.save(defaultConfig);
      return structuredClone(defaultConfig);
    }
  }

  get(): AppConfig {
    return structuredClone(this.config);
  }

  update(partial: Partial<AppConfig>): ConfigUpdateResult {
    const merged = deepMerge(
      this.config as Record<string, unknown>,
      partial as Record<string, unknown>,
    );
    const validationResult = ConfigSchema.safeParse(merged);

    if (!validationResult.success) {
      const errorMessages = validationResult.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      return {
        success: false,
        config: this.get(),
        errors: errorMessages,
      };
    }

    this.config = validationResult.data;
    this.save(this.config);
    logger.info("Config updated and saved", { path: this.configFilePath });
    return { success: true, config: this.get() };
  }

  save(config: AppConfig): void {
    const directory = path.dirname(this.configFilePath);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    fs.writeFileSync(
      this.configFilePath,
      JSON.stringify(config, null, 2),
      "utf-8",
    );
  }

  getPath(): string {
    return this.configFilePath;
  }
}

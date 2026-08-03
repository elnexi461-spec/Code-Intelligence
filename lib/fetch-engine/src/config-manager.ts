import type { IConfigManager } from "./types.js";

export class ConfigManager implements IConfigManager {
  private readonly store: Record<string, unknown>;

  constructor(overrides: Record<string, unknown> = {}) {
    this.store = {
      baseUrl: process.env["FETCH_BASE_URL"] ?? "",
      defaultTimeoutMs: Number(process.env["FETCH_TIMEOUT_MS"] ?? 30_000),
      maxConnectionsPerOrigin: Number(process.env["FETCH_MAX_CONNECTIONS"] ?? 10),
      followRedirects: (process.env["FETCH_FOLLOW_REDIRECTS"] ?? "true") === "true",
      maxRedirects: Number(process.env["FETCH_MAX_REDIRECTS"] ?? 10),
      decompress: (process.env["FETCH_DECOMPRESS"] ?? "true") === "true",
      keepAlive: (process.env["FETCH_KEEP_ALIVE"] ?? "true") === "true",
      keepAliveTimeoutMs: Number(process.env["FETCH_KEEP_ALIVE_TIMEOUT_MS"] ?? 60_000),
      http2: (process.env["FETCH_HTTP2"] ?? "true") === "true",
      logLevel: process.env["LOG_LEVEL"] ?? "info",
      fetchTimeoutMs: Number(process.env["FETCH_TIMEOUT_MS"] ?? 30_000),
      includeRawHtml: false,
      includeRawJson: true,
      ...overrides,
    };
  }

  get<T>(key: string, defaultValue?: T): T {
    const value = this.store[key];
    if (value === undefined) {
      if (defaultValue !== undefined) return defaultValue;
      throw new Error(`ConfigManager: missing required key "${key}"`);
    }
    return value as T;
  }

  getAll(): Record<string, unknown> {
    return { ...this.store };
  }

  set(key: string, value: unknown): void {
    this.store[key] = value;
  }
}

import { readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_CONFIG } from './defaults.js';
import { ScraperConfigSchema } from './schema.js';
import type { ScraperConfig } from './types.js';

function deepMerge<T>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val !== undefined && val !== null) {
      if (typeof val === 'object' && !Array.isArray(val) && typeof base[key] === 'object') {
        result[key] = deepMerge(base[key] as object, val as object) as T[typeof key];
      } else {
        result[key] = val as T[typeof key];
      }
    }
  }
  return result;
}

function applyEnvOverrides(config: ScraperConfig): ScraperConfig {
  const env = process.env;
  const out = { ...config };

  if (env['REA_CONCURRENCY']) out.fetch = { ...out.fetch, concurrency: parseInt(env['REA_CONCURRENCY']) };
  if (env['REA_RPS']) out.fetch = { ...out.fetch, requestsPerSecondPerDomain: parseFloat(env['REA_RPS']) };
  if (env['REA_TIMEOUT_MS']) out.fetch = { ...out.fetch, requestTimeoutMs: parseInt(env['REA_TIMEOUT_MS']) };
  if (env['REA_OUTPUT_DIR']) out.storage = { ...out.storage, outputDir: env['REA_OUTPUT_DIR'] };
  if (env['REA_LOG_LEVEL']) out.log = { ...out.log, level: env['REA_LOG_LEVEL'] as ScraperConfig['log']['level'] };
  if (env['REA_LOG_FORMAT']) out.log = { ...out.log, format: env['REA_LOG_FORMAT'] as ScraperConfig['log']['format'] };
  if (env['REA_QUEUE_BACKEND']) out.queue = { ...out.queue, backend: env['REA_QUEUE_BACKEND'] as ScraperConfig['queue']['backend'] };
  if (env['REA_MAX_ATTEMPTS']) out.retry = { ...out.retry, maxAttempts: parseInt(env['REA_MAX_ATTEMPTS']) };

  return out;
}

export class ConfigManager {
  private config: ScraperConfig;

  constructor(configPath?: string, overrides?: Partial<ScraperConfig>) {
    let merged = { ...DEFAULT_CONFIG };

    if (configPath && existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8');
      const fileConfig = parseYaml(raw) as Partial<ScraperConfig>;
      merged = deepMerge(merged, fileConfig);
    }

    merged = applyEnvOverrides(merged);

    if (overrides) {
      merged = deepMerge(merged, overrides);
    }

    const result = ScraperConfigSchema.safeParse(merged);
    if (!result.success) {
      const errs = result.error.errors.map(e => `  ${e.path.join('.')}: ${e.message}`).join('\n');
      throw new Error(`Invalid scraper configuration:\n${errs}`);
    }

    this.config = result.data as ScraperConfig;
  }

  get(): ScraperConfig {
    return this.config;
  }

  update(overrides: Partial<ScraperConfig>): void {
    const merged = deepMerge(this.config, overrides);
    const result = ScraperConfigSchema.safeParse(merged);
    if (!result.success) throw new Error('Invalid config update');
    this.config = result.data as ScraperConfig;
  }
}

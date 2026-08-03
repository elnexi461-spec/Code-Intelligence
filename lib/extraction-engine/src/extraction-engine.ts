import type { Property, ExtractionEngineConfig, ExtractionStrategy, ParseResult } from "./types.js";
import type { ILogger, IConfigManager } from "@workspace/fetch-engine";
import { FetchEngine, ConfigManager } from "@workspace/fetch-engine";
import { NextDataParser } from "./parsers/next-data-parser.js";
import { JsonLdParser } from "./parsers/json-ld-parser.js";
import { HtmlParser } from "./parsers/html-parser.js";
import { PropertyMapper } from "./parsers/property-mapper.js";

export class ExtractionEngine {
  private readonly fetchEngine: FetchEngine;
  private readonly cfg: Required<ExtractionEngineConfig>;
  private readonly logger: ILogger;
  private readonly configMgr: IConfigManager;

  private readonly nextDataParser = new NextDataParser();
  private readonly jsonLdParser = new JsonLdParser();
  private readonly htmlParser = new HtmlParser();

  constructor(config: ExtractionEngineConfig = {}, fetchEngine?: FetchEngine, configMgr?: IConfigManager, logger?: ILogger) {
    this.configMgr = configMgr ?? new ConfigManager();
    this.cfg = {
      fetchTimeoutMs: config.fetchTimeoutMs ?? this.configMgr.get<number>("fetchTimeoutMs", 30_000),
      includeRawHtml: config.includeRawHtml ?? this.configMgr.get<boolean>("includeRawHtml", false),
      includeRawJson: config.includeRawJson ?? this.configMgr.get<boolean>("includeRawJson", true),
      playwrightFallback: config.playwrightFallback ?? null!,
    };
    this.logger = logger ?? {
      debug: (obj: Record<string, unknown>, msg?: string) => console.debug(msg ?? "", obj),
      info: (obj: Record<string, unknown>, msg?: string) => console.info(msg ?? "", obj),
      warn: (obj: Record<string, unknown>, msg?: string) => console.warn(msg ?? "", obj),
      error: (obj: Record<string, unknown>, msg?: string) => console.error(msg ?? "", obj),
    };
    this.fetchEngine = fetchEngine ?? new FetchEngine({ defaultTimeoutMs: this.cfg.fetchTimeoutMs }, this.configMgr, this.logger);
  }

  async extract(url: string): Promise<Property> {
    this.logger.info({ url }, "extracting property");
    let html: string;
    try {
      const res = await this.fetchEngine.get(url, { timeout: this.cfg.fetchTimeoutMs, headers: { Referer: "https://www.google.com/" } });
      if (res.cloudflareBlocked && this.cfg.playwrightFallback) {
        this.logger.warn({ url, status: res.status }, "CF block — trying playwright fallback");
        const fallbackHtml = await this.cfg.playwrightFallback(url);
        if (!fallbackHtml) throw new Error(`Playwright fallback returned null for ${url}`);
        html = fallbackHtml;
      } else if (!res.ok && res.body.length < 1000) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
      } else {
        if (!res.ok) this.logger.warn({ url, status: res.status }, "non-2xx — attempting extraction anyway");
        html = res.body;
      }
    } catch (err) {
      if (this.cfg.playwrightFallback) {
        this.logger.warn({ url, err: String(err) }, "fetch failed — trying playwright fallback");
        const fallbackHtml = await this.cfg.playwrightFallback(url);
        if (!fallbackHtml) throw err;
        html = fallbackHtml;
      } else { throw err; }
    }
    return this._extractFromHtml(html, url);
  }

  extractFromHtml(html: string, url: string): Property {
    return this._extractFromHtml(html, url);
  }

  private _extractFromHtml(html: string, url: string): Property {
    this.logger.debug({ url, htmlBytes: html.length }, "running extraction strategies");

    // Priority 1 — __NEXT_DATA__
    if (this.nextDataParser.canParse(html, url)) {
      const result = this.nextDataParser.parse(html, url);
      if (result.confidence > 0) {
        this.logger.info({ url, strategy: "next-data", confidence: result.confidence }, "extracted via next-data");
        return this._finalise(result, "next-data", html);
      }
    }

    // Priority 2 — JSON-LD
    if (this.jsonLdParser.canParse(html, url)) {
      const jsonLdResult = this.jsonLdParser.parse(html, url);
      if (jsonLdResult.confidence > 0.1) {
        const htmlResult = this.htmlParser.parse(html, url);
        const mergedResult: ParseResult = { data: PropertyMapper.merge(jsonLdResult.data, htmlResult.data), confidence: jsonLdResult.confidence };
        this.logger.info({ url, strategy: "json-ld", confidence: mergedResult.confidence }, "extracted via json-ld");
        return this._finalise(mergedResult, "json-ld", html);
      }
    }

    // Priority 3 — HTML
    const htmlResult = this.htmlParser.parse(html, url);
    if (htmlResult.confidence > 0) {
      this.logger.info({ url, strategy: "html", confidence: htmlResult.confidence }, "extracted via html");
      return this._finalise(htmlResult, "html", html);
    }

    // Priority 4 — Playwright hook (interface only)
    this.logger.warn({ url }, "all static strategies returned no data — playwright fallback needed");
    return this._finalise({ data: { url }, confidence: 0 }, "playwright", html);
  }

  private _finalise(result: ParseResult, strategy: ExtractionStrategy, html: string): Property {
    return PropertyMapper.finalise(result.data, result.data.url ?? "", strategy, result.confidence, html, this.cfg.includeRawHtml, this.cfg.includeRawJson);
  }

  async close(): Promise<void> { await this.fetchEngine.close(); }
}

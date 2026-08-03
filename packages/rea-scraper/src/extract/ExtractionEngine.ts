import { NextDataParser } from './NextDataParser.js';
import { JsonLdParser } from './JsonLdParser.js';
import { HtmlParser } from './HtmlParser.js';
import type { ExtractionResult } from './types.js';
import type { FetchResponse } from '../fetch/types.js';
import { ParseError } from '../errors/error-types.js';
import { getLogger } from '../logger/Logger.js';

// Playwright is a stub — full implementation deferred
async function playwrightFallback(_url: string): Promise<ExtractionResult | null> {
  getLogger().warn({ url: _url }, 'playwright fallback not yet implemented');
  return null;
}

export class ExtractionEngine {
  private readonly nextData = new NextDataParser();
  private readonly jsonLd = new JsonLdParser();
  private readonly html = new HtmlParser();
  private readonly log = getLogger();

  async extract(response: FetchResponse): Promise<ExtractionResult> {
    const { url, body } = response;

    // Priority 1 — __NEXT_DATA__
    const nextResult = this.nextData.parse(body, url);
    if (nextResult && nextResult.confidence > 0.2) {
      this.log.debug({ url, strategy: 'next-data', confidence: nextResult.confidence }, 'extracted');
      return nextResult;
    }

    // Priority 2 — JSON-LD
    const ldResult = this.jsonLd.parse(body, url);
    if (ldResult && ldResult.confidence > 0.2) {
      this.log.debug({ url, strategy: 'json-ld', confidence: ldResult.confidence }, 'extracted');
      // Merge with any partial next-data fields
      if (nextResult) {
        ldResult.record = { ...nextResult.record, ...ldResult.record };
      }
      return ldResult;
    }

    // Priority 3 — HTML parsing
    const htmlResult = await this.html.parse(body, url);
    if (htmlResult && htmlResult.confidence > 0.1) {
      this.log.debug({ url, strategy: 'html', confidence: htmlResult.confidence }, 'extracted');
      return htmlResult;
    }

    // Priority 4 — Playwright stub
    const pwResult = await playwrightFallback(url);
    if (pwResult) return pwResult;

    throw new ParseError(
      `Could not extract property data from ${url} (tried all strategies)`,
      url,
    );
  }

  /**
   * Detect which strategy will be used without fully extracting.
   * Useful for routing and benchmarking.
   */
  detectStrategy(html: string): 'next-data' | 'json-ld' | 'html' | 'playwright' {
    if (/<script[^>]+id=["']__NEXT_DATA__["']/i.test(html)) return 'next-data';
    if (/<script[^>]+type=["']application\/ld\+json["']/i.test(html)) return 'json-ld';
    if (html.includes('<html')) return 'html';
    return 'playwright';
  }
}

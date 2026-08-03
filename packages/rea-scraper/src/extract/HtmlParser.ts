import type { ExtractionResult, PropertyRecord } from './types.js';
import type { CheerioAPI } from 'cheerio';

async function loadCheerio(html: string): Promise<CheerioAPI> {
  const { load } = await import('cheerio');
  return load(html);
}

/**
 * CSS-selector-based fallback parser for realestate.com.au.
 * Targets known data-testid attributes which are more stable than class names.
 */
export class HtmlParser {
  async parse(html: string, url: string): Promise<ExtractionResult | null> {
    let $: CheerioAPI;
    try {
      $ = await loadCheerio(html);
    } catch {
      return null;
    }

    const get = (sel: string) => $(sel).first().text().trim() || undefined;

    const streetAddress =
      get('[data-testid="listing-details__summary-title"]') ??
      get('h1.property-info__title') ??
      get('h1');

    const priceRaw =
      get('[data-testid*="price"]') ??
      get('.property-price');

    const suburb =
      get('[data-testid="listing-details__button-copy-suburb"]') ??
      get('.suburb-locality');

    const bedsText = get('[aria-label*="Bed"]') ?? get('[data-testid*="beds"]');
    const bathsText = get('[aria-label*="Bath"]') ?? get('[data-testid*="baths"]');
    const carsText = get('[aria-label*="Parking"]') ?? get('[data-testid*="cars"]');

    const description =
      get('[data-testid="listing-details__description"]') ??
      get('.property-description');

    const imageUrls: string[] = [];
    $('img[src*="realestate.com.au"]').each((_i, el) => {
      const src = $(el).attr('src');
      if (src && !imageUrls.includes(src)) imageUrls.push(src);
    });
    $('img[data-src*="realestate.com.au"]').each((_i, el) => {
      const src = $(el).attr('data-src');
      if (src && !imageUrls.includes(src)) imageUrls.push(src);
    });

    const agentName =
      get('[data-testid="listing-details__agent-name"]') ??
      get('.agent-name');
    const agentPhone =
      get('[data-testid="listing-details__agent-phone"]') ??
      get('.agent-phone');
    const agencyName =
      get('[data-testid="listing-details__agent-agency-name"]') ??
      get('.agency-name');

    if (!streetAddress && !priceRaw && !suburb) return null;

    const record: PropertyRecord = {
      url,
      scrapedAt: new Date().toISOString(),
      extractionStrategy: 'html',
      streetAddress,
      suburb,
      priceRaw,
      bedrooms: this.parseNum(bedsText),
      bathrooms: this.parseNum(bathsText),
      carSpaces: this.parseNum(carsText),
      description,
      imageUrls: imageUrls.slice(0, 50),
      agents: agentName ? [{ name: agentName, phone: agentPhone, agencyName }] : [],
    };

    return {
      record,
      strategy: 'html',
      confidence: this.calcConfidence(record),
    };
  }

  private parseNum(text: string | undefined): number | undefined {
    if (!text) return undefined;
    const n = parseInt(text.replace(/\D/g, ''), 10);
    return isNaN(n) ? undefined : n;
  }

  private calcConfidence(record: PropertyRecord): number {
    const filled = [
      record.streetAddress, record.suburb, record.priceRaw,
      record.bedrooms, record.bathrooms, record.description,
    ].filter(v => v !== undefined);
    return filled.length / 6;
  }
}

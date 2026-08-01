import { PropertyMapper } from './PropertyMapper.js';
import type { ExtractionResult } from './types.js';

const NEXT_DATA_RE = /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

export class NextDataParser {
  private readonly mapper = new PropertyMapper();

  parse(html: string, url: string): ExtractionResult | null {
    const match = NEXT_DATA_RE.exec(html);
    if (!match?.[1]) return null;

    let data: unknown;
    try {
      data = JSON.parse(match[1]);
    } catch {
      return null;
    }

    const partial = this.mapper.fromNextData(data, url);

    // Require at least address or price to consider this a valid property page
    if (!partial.streetAddress && !partial.priceRaw && !partial.suburb) return null;

    const record = {
      url,
      scrapedAt: new Date().toISOString(),
      extractionStrategy: 'next-data' as const,
      ...partial,
    };

    return {
      record,
      strategy: 'next-data',
      confidence: this.calcConfidence(record),
      rawData: data,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private calcConfidence(record: any): number {
    const fields: (keyof typeof record)[] = [
      'streetAddress', 'suburb', 'priceRaw', 'bedrooms', 'bathrooms',
      'propertyType', 'description', 'imageUrls', 'agents',
    ];
    const present = fields.filter(f => {
      const v = record[f];
      return v !== undefined && v !== null && v !== '' &&
        (!Array.isArray(v) || v.length > 0);
    });
    return present.length / fields.length;
  }
}

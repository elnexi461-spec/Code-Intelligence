import { PropertyMapper } from './PropertyMapper.js';
import type { ExtractionResult, PropertyRecord } from './types.js';

const JSON_LD_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const PROPERTY_TYPES = new Set([
  'House', 'Apartment', 'Product', 'Residence', 'Accommodation',
  'RealEstateListing', 'SingleFamilyResidence',
]);

export class JsonLdParser {
  private readonly mapper = new PropertyMapper();

  parse(html: string, url: string): ExtractionResult | null {
    const schemas = this.extractSchemas(html);
    if (schemas.length === 0) return null;

    // Find the most relevant schema (property/listing type)
    const schema = schemas.find(s => PROPERTY_TYPES.has(s['@type'] as string)) ?? schemas[0];

    const partial = this.mapper.fromJsonLd(schema, url);
    if (!partial.streetAddress && !partial.suburb && !partial.latitude) return null;

    const record: PropertyRecord = {
      url,
      scrapedAt: new Date().toISOString(),
      extractionStrategy: 'json-ld',
      ...partial,
    };

    return {
      record,
      strategy: 'json-ld',
      confidence: this.calcConfidence(record),
      rawData: schema,
    };
  }

  private extractSchemas(html: string): Record<string, unknown>[] {
    const schemas: Record<string, unknown>[] = [];
    let match: RegExpExecArray | null;
    JSON_LD_RE.lastIndex = 0;
    while ((match = JSON_LD_RE.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(match[1]!);
        if (Array.isArray(parsed)) schemas.push(...parsed);
        else schemas.push(parsed);
      } catch {
        // skip malformed
      }
    }
    return schemas;
  }

  private calcConfidence(record: PropertyRecord): number {
    const filled = [record.streetAddress, record.suburb, record.latitude,
      record.longitude, record.description, record.priceRaw].filter(Boolean);
    return filled.length / 6;
  }
}

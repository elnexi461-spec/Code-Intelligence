import type { Property, ExtractionStrategy } from "../types.js";
import { normalisePropertyType, normaliseStatus } from "../utils.js";

const DEFAULT_PROPERTY: Property = {
  propertyId: null, url: "", fullAddress: null, street: null, suburb: null,
  state: null, postcode: null, price: null, priceNumeric: null,
  bedrooms: null, bathrooms: null, carSpaces: null,
  landSize: null, landSizeUnit: null, buildingSize: null, buildingSizeUnit: null,
  propertyType: "unknown", images: [], floorplans: [], description: null,
  features: [], agents: [], latitude: null, longitude: null, saleHistory: [],
  listingStatus: "unknown", listingDate: null, lastUpdated: null,
  rawJson: null, rawHtml: null, extractionStrategy: "html",
  confidenceScore: 0, extractedAt: new Date().toISOString(),
};

export class PropertyMapper {
  static merge(base: Partial<Property>, patch: Partial<Property>): Partial<Property> {
    const result: Partial<Property> = { ...base };
    const scalars: Array<keyof Property> = [
      "propertyId", "fullAddress", "street", "suburb", "state", "postcode",
      "price", "priceNumeric", "bedrooms", "bathrooms", "carSpaces",
      "landSize", "landSizeUnit", "buildingSize", "buildingSizeUnit",
      "description", "latitude", "longitude", "listingDate", "lastUpdated", "rawJson",
    ];
    for (const key of scalars) {
      if (base[key] == null && patch[key] != null) (result as Record<string, unknown>)[key] = patch[key];
    }
    if ((base.propertyType == null || base.propertyType === "unknown") && patch.propertyType && patch.propertyType !== "unknown") result.propertyType = patch.propertyType;
    if ((base.listingStatus == null || base.listingStatus === "unknown") && patch.listingStatus && patch.listingStatus !== "unknown") result.listingStatus = patch.listingStatus;

    result.images = dedupe([...(base.images ?? []), ...(patch.images ?? [])]);
    result.floorplans = dedupe([...(base.floorplans ?? []), ...(patch.floorplans ?? [])]);
    result.features = dedupe([...(base.features ?? []), ...(patch.features ?? [])]);

    const existing = base.agents ?? [];
    const incoming = patch.agents ?? [];
    const merged = [...existing];
    for (const a of incoming) {
      if (!merged.find((e) => e.name && a.name && e.name.toLowerCase() === a.name.toLowerCase())) merged.push(a);
    }
    result.agents = merged;

    const histMap = new Map<string, (typeof DEFAULT_PROPERTY.saleHistory)[0]>();
    for (const e of [...(base.saleHistory ?? []), ...(patch.saleHistory ?? [])]) histMap.set(`${e.date}-${e.price}`, e);
    result.saleHistory = [...histMap.values()];

    return result;
  }

  static finalise(partial: Partial<Property>, url: string, strategy: ExtractionStrategy, confidence: number, rawHtml: string | null, includeRawHtml: boolean, includeRawJson: boolean): Property {
    return {
      ...DEFAULT_PROPERTY, ...partial,
      url: partial.url ?? url,
      extractionStrategy: strategy,
      confidenceScore: Math.round(confidence * 100) / 100,
      extractedAt: new Date().toISOString(),
      rawHtml: includeRawHtml ? rawHtml : null,
      rawJson: includeRawJson ? (partial.rawJson ?? null) : null,
      propertyType: partial.propertyType ?? "unknown",
      listingStatus: partial.listingStatus ?? "unknown",
      images: partial.images ?? [], floorplans: partial.floorplans ?? [],
      features: partial.features ?? [], agents: partial.agents ?? [],
      saleHistory: partial.saleHistory ?? [],
    };
  }

  static normalise(p: Property): Property {
    return {
      ...p,
      propertyType: p.propertyType === "unknown" ? normalisePropertyType("") : p.propertyType,
      listingStatus: p.listingStatus === "unknown" ? normaliseStatus("") : p.listingStatus,
    };
  }
}

function dedupe(arr: string[]): string[] { return [...new Set(arr.filter(Boolean))]; }

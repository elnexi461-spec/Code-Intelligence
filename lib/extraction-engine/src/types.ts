export type ExtractionStrategy = "next-data" | "json-ld" | "html" | "playwright";

export type ListingStatus = "for-sale" | "for-rent" | "sold" | "leased" | "off-market" | "unknown";

export type PropertyType = "house" | "apartment" | "unit" | "townhouse" | "villa" | "land" | "rural" | "commercial" | "other" | "unknown";

export interface SaleHistoryEntry {
  date: string;
  price: number | null;
  type: string;
  agency?: string;
}

export interface AgentInfo {
  name: string | null;
  agency: string | null;
  phone: string | null;
  email: string | null;
}

export interface Property {
  propertyId: string | null;
  url: string;
  fullAddress: string | null;
  street: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  price: string | null;
  priceNumeric: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  carSpaces: number | null;
  landSize: number | null;
  landSizeUnit: string | null;
  buildingSize: number | null;
  buildingSizeUnit: string | null;
  propertyType: PropertyType;
  images: string[];
  floorplans: string[];
  description: string | null;
  features: string[];
  agents: AgentInfo[];
  latitude: number | null;
  longitude: number | null;
  saleHistory: SaleHistoryEntry[];
  listingStatus: ListingStatus;
  listingDate: string | null;
  lastUpdated: string | null;
  rawJson: Record<string, unknown> | null;
  rawHtml: string | null;
  extractionStrategy: ExtractionStrategy;
  confidenceScore: number;
  extractedAt: string;
}

export interface ParseResult {
  data: Partial<Property>;
  confidence: number;
}

export interface IParser {
  canParse(html: string, url: string): boolean;
  parse(html: string, url: string): ParseResult;
}

export type PlaywrightFallbackHook = (url: string) => Promise<string | null>;

export interface ExtractionEngineConfig {
  fetchTimeoutMs?: number;
  includeRawHtml?: boolean;
  includeRawJson?: boolean;
  playwrightFallback?: PlaywrightFallbackHook;
}

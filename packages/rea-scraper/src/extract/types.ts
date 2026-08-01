export type ExtractionStrategy = 'next-data' | 'json-ld' | 'html' | 'playwright';

export interface AgentDetails {
  name: string;
  phone?: string;
  email?: string;
  agencyName?: string;
  agencyId?: string;
  agencyLogo?: string;
}

export interface PropertyRecord {
  // Identity
  listingId?: string;
  url: string;
  scrapedAt: string;
  extractionStrategy: ExtractionStrategy;

  // Address
  streetAddress?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  latitude?: number;
  longitude?: number;

  // Property
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landSizeM2?: number;
  buildingSizeM2?: number;
  isNewDevelopment?: boolean;

  // Pricing
  priceRaw?: string;
  priceMin?: number;
  priceMax?: number;
  isAuction?: boolean;
  auctionDate?: string;

  // Listing
  headline?: string;
  description?: string;
  propertyFeatures?: string[];
  listedDate?: string;

  // Media
  imageUrls?: string[];
  floorplanUrls?: string[];
  hasVirtualTour?: boolean;

  // Agent
  agents?: AgentDetails[];
}

export interface ExtractionResult {
  record: PropertyRecord;
  strategy: ExtractionStrategy;
  confidence: number; // 0-1, based on field count
  rawData?: unknown;
}

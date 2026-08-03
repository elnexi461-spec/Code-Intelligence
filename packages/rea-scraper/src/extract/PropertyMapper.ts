import type { PropertyRecord, AgentDetails } from './types.js';

/**
 * Maps raw extracted data into a normalized PropertyRecord.
 * Handles the nested __NEXT_DATA__ shape from realestate.com.au.
 */
export class PropertyMapper {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fromNextData(data: any, url: string): Partial<PropertyRecord> {
    // REA embeds listing data at multiple possible paths
    const listing =
      data?.props?.pageProps?.listing ??
      data?.props?.pageProps?.data?.listing ??
      data?.props?.pageProps?.property ??
      data?.listing ??
      null;

    if (!listing) return {};

    const address = listing.address ?? listing.propertyAddress ?? {};
    const features = listing.generalFeatures ?? listing.features ?? {};
    const price = listing.price ?? listing.priceDetails ?? {};
    const media = listing.media ?? listing.propertyMedia ?? {};
    const agents: AgentDetails[] = this.extractAgents(listing);

    return {
      listingId: String(listing.id ?? listing.listingId ?? ''),
      streetAddress: this.buildStreetAddress(address),
      suburb: address.suburb ?? address.locality ?? '',
      state: address.state ?? '',
      postcode: String(address.postcode ?? ''),
      latitude: address.location?.lat ?? address.latitude ?? undefined,
      longitude: address.location?.long ?? address.longitude ?? undefined,
      propertyType: listing.propertyType ?? listing.category ?? undefined,
      bedrooms: this.toInt(features.bedrooms?.value ?? features.beds ?? listing.bedrooms),
      bathrooms: this.toInt(features.bathrooms?.value ?? features.baths ?? listing.bathrooms),
      carSpaces: this.toInt(features.parkingSpaces?.value ?? features.cars ?? listing.carSpaces),
      landSizeM2: this.toArea(listing.landDetails?.area ?? listing.landSize),
      buildingSizeM2: this.toArea(listing.buildingDetails?.area ?? listing.buildingSize),
      priceRaw: price.display ?? price.priceText ?? listing.priceDisplay ?? undefined,
      priceMin: this.toInt(price.from ?? price.priceFrom),
      priceMax: this.toInt(price.to ?? price.priceTo),
      isAuction: !!(listing.auctionDetails ?? listing.isAuction),
      auctionDate: listing.auctionDetails?.dateTime ?? listing.auctionDate ?? undefined,
      headline: listing.headline ?? listing.title ?? undefined,
      description: listing.description ?? undefined,
      propertyFeatures: this.extractFeatures(listing),
      imageUrls: this.extractImages(media, listing),
      floorplanUrls: this.extractFloorplans(media),
      hasVirtualTour: !!(media.virtualTours?.length ?? listing.has3DTour),
      listedDate: listing.listingDate ?? listing.dateAvailable ?? undefined,
      agents,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fromJsonLd(schema: any, url: string): Partial<PropertyRecord> {
    if (!schema) return {};
    const address = schema.address ?? {};
    const geo = schema.geo ?? {};

    return {
      streetAddress: address.streetAddress ?? undefined,
      suburb: address.addressLocality ?? undefined,
      state: address.addressRegion ?? undefined,
      postcode: address.postalCode ?? undefined,
      latitude: geo.latitude ? parseFloat(geo.latitude) : undefined,
      longitude: geo.longitude ? parseFloat(geo.longitude) : undefined,
      propertyType: schema['@type'] ?? undefined,
      priceRaw: schema.offers?.price ?? schema.offers?.priceSpecification?.price ?? undefined,
      description: schema.description ?? undefined,
      imageUrls: this.normalizeImages(schema.image),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractAgents(listing: any): AgentDetails[] {
    const raw = listing.agents ?? listing.advertiser?.agents ?? listing.listingAgent;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return arr.map((a: any) => ({
      name: (a.name || (a.firstName + (a.lastName ? ` ${a.lastName}` : ''))) || '',
      phone: a.phone ?? a.phoneNumber ?? undefined,
      email: a.email ?? undefined,
      agencyName: a.agency?.name ?? listing.advertiser?.name ?? undefined,
      agencyId: String(a.agency?.id ?? listing.advertiser?.id ?? ''),
      agencyLogo: a.agency?.logo?.images?.[0]?.url ?? undefined,
    }));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractImages(media: any, listing: any): string[] {
    const images =
      media.images ??
      (media.mainImage ? [media.mainImage, ...(media.images ?? [])] : null) ??
      media.images ??
      listing.images ??
      [];
    return this.normalizeImages(images);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizeImages(images: any): string[] {
    if (!images) return [];
    const arr = Array.isArray(images) ? images : [images];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return arr.map((img: any) => {
      if (typeof img === 'string') return img;
      return (img?.url ?? img?.src ?? img?.uri ?? (img?.server && img?.uri ? img.server + img.uri : '')) || '';
    }).filter(Boolean);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractFloorplans(media: any): string[] {
    const fp = media.floorplans ?? media.floorPlan ?? [];
    const arr = Array.isArray(fp) ? fp : [fp];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return arr.map((f: any) => f?.url ?? f?.uri ?? '').filter(Boolean);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractFeatures(listing: any): string[] {
    const features: string[] = [];
    const f = listing.features ?? listing.propertyFeatures ?? listing.listingFeatures;
    if (Array.isArray(f)) {
      for (const item of f) {
        if (typeof item === 'string') features.push(item);
        else if (item?.name) features.push(item.name);
        else if (item?.displayLabel) features.push(item.displayLabel);
      }
    }
    // Also check structured feature categories
    const cats = listing.structuredFeatures ?? listing.featureCategories ?? [];
    for (const cat of cats) {
      for (const feat of cat.features ?? []) {
        if (feat?.name) features.push(feat.name);
      }
    }
    return features;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildStreetAddress(address: any): string {
    const parts = [
      address.streetNumber ?? address.houseNumber,
      address.street ?? address.streetName,
    ].filter(Boolean);
    return parts.join(' ');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toInt(val: any): number | undefined {
    if (val === undefined || val === null || val === '') return undefined;
    const n = parseInt(String(val), 10);
    return isNaN(n) ? undefined : n;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toArea(val: any): number | undefined {
    if (val === undefined || val === null || val === '') return undefined;
    if (typeof val === 'object') {
      const v = val.value ?? val.size ?? val.area;
      return this.toArea(v);
    }
    const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? undefined : n;
  }
}

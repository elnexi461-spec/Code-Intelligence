import type { IParser, ParseResult, Property, AgentInfo } from "../types.js";
import { normalisePropertyType, normaliseStatus, parsePrice, parseSizeValue, safeStr, safeNum, safeFloat, collectStrings, extractIdFromUrl, dedupe } from "../utils.js";

export class JsonLdParser implements IParser {
  canParse(html: string, _url: string): boolean {
    return html.includes("application/ld+json");
  }

  parse(html: string, url: string): ParseResult {
    const graphs = this._extractGraphs(html);
    if (graphs.length === 0) return { data: {}, confidence: 0 };
    const listing = this._findListing(graphs);
    if (!listing) return { data: {}, confidence: 0.1 };
    const data = this._map(listing, url, graphs);
    return { data, confidence: this._score(data) };
  }

  private _extractGraphs(html: string): Record<string, unknown>[] {
    const results: Record<string, unknown>[] = [];
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(m[1]!);
        if (Array.isArray(parsed)) results.push(...parsed);
        else if (parsed?.["@graph"]) results.push(...(parsed["@graph"] as Record<string, unknown>[]));
        else results.push(parsed);
      } catch { /* skip */ }
    }
    return results;
  }

  private _findListing(graphs: Record<string, unknown>[]): Record<string, unknown> | null {
    const listingTypes = new Set(["RealEstateListing", "Residence", "Apartment", "House", "SingleFamilyResidence", "Product"]);
    for (const g of graphs) {
      const type = safeStr(g["@type"]);
      if (type && listingTypes.has(type)) return g;
    }
    for (const g of graphs) {
      if ((g["address"] || g["geo"]) && (g["offers"] || g["price"] || g["name"])) return g;
    }
    return null;
  }

  private _map(l: Record<string, unknown>, url: string, _all: Record<string, unknown>[]): Partial<Property> {
    const addr = (l["address"] ?? {}) as Record<string, unknown>;
    const geo = (l["geo"] ?? {}) as Record<string, unknown>;
    const offers = (l["offers"] ?? {}) as Record<string, unknown>;

    const rawPrice = safeStr(offers["price"] ?? offers["lowPrice"] ?? l["price"]) ?? "";
    const priceDisplay = safeStr(offers["description"] ?? offers["priceSpecification"]) ?? rawPrice;
    const streetNum = safeStr(addr["streetAddress"]) ?? safeStr(addr["streetNumber"]) ?? "";
    const streetName = safeStr(addr["street"]) ?? "";
    const street = streetNum && streetName ? `${streetNum} ${streetName}` : (streetNum || streetName);
    const suburb = safeStr(addr["addressLocality"] ?? addr["suburb"] ?? addr["city"]) ?? null;
    const state = safeStr(addr["addressRegion"] ?? addr["state"]) ?? null;
    const postcode = safeStr(addr["postalCode"] ?? addr["postcode"]) ?? null;
    const country = safeStr(addr["addressCountry"]) ?? null;
    const fullAddress =
      safeStr(l["address"] as unknown as string) ??
      ([street, suburb, state, postcode, country].filter(Boolean).join(", ") || null);

    const images = dedupe(this._extractImages(l["image"] ?? l["photo"] ?? l["thumbnail"]));
    const floorplans = dedupe(this._extractFloorplans(l["additionalProperty"] ?? []));
    const features = collectStrings(l["amenityFeature"] ?? l["features"] ?? []);
    const agents = this._extractAgents(l["agent"] ?? l["offeredBy"] ?? l["seller"]);
    const propertyTypeRaw = safeStr(l["@type"] ?? l["propertyType"] ?? l["accommodationType"]) ?? "";
    const { value: landVal, unit: landUnit } = parseSizeValue(safeStr(l["landSize"] ?? l["floorSize"]) ?? "");

    return {
      propertyId: safeStr(l["@id"] ?? l["identifier"] ?? l["productID"]) ?? extractIdFromUrl(url),
      url: safeStr(l["url"]) ?? url, fullAddress, street: street || null, suburb, state, postcode,
      price: priceDisplay || rawPrice || null, priceNumeric: parsePrice(rawPrice),
      bedrooms: safeNum(l["numberOfRooms"] ?? l["numberOfBedrooms"] ?? l["bedrooms"]),
      bathrooms: safeNum(l["numberOfBathroomsTotal"] ?? l["bathrooms"]),
      carSpaces: safeNum(l["numberOfParkingSpaces"] ?? l["carSpaces"]),
      landSize: landVal, landSizeUnit: landUnit, buildingSize: null, buildingSizeUnit: null,
      propertyType: normalisePropertyType(propertyTypeRaw),
      images, floorplans, description: safeStr(l["description"]) ?? null, features, agents,
      latitude: safeFloat(geo["latitude"] ?? geo["lat"]),
      longitude: safeFloat(geo["longitude"] ?? geo["lon"] ?? geo["lng"]),
      saleHistory: [],
      listingStatus: normaliseStatus(safeStr(l["availability"] ?? l["status"]) ?? ""),
      listingDate: safeStr(l["dateCreated"] ?? l["datePublished"]) ?? null,
      lastUpdated: safeStr(l["dateModified"]) ?? null,
      rawJson: l,
    };
  }

  private _extractImages(raw: unknown): string[] {
    if (!raw) return [];
    if (typeof raw === "string") return raw.startsWith("http") ? [raw] : [];
    if (Array.isArray(raw)) {
      return raw.flatMap((item) => {
        if (typeof item === "string") return item ? [item] : [];
        if (typeof item === "object" && item !== null) {
          const url = safeStr((item as Record<string, unknown>)["url"] ?? (item as Record<string, unknown>)["contentUrl"] ?? (item as Record<string, unknown>)["@id"]);
          return url ? [url] : [];
        }
        return [];
      });
    }
    if (typeof raw === "object") {
      const url = safeStr((raw as Record<string, unknown>)["url"] ?? (raw as Record<string, unknown>)["contentUrl"]);
      return url ? [url] : [];
    }
    return [];
  }

  private _extractFloorplans(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      if (typeof item !== "object" || !item) return [];
      const obj = item as Record<string, unknown>;
      if (!(safeStr(obj["name"]) ?? "").toLowerCase().includes("floor")) return [];
      const url = safeStr(obj["value"] ?? obj["url"]);
      return url ? [url] : [];
    });
  }

  private _extractAgents(raw: unknown): AgentInfo[] {
    if (!raw) return [];
    const items = Array.isArray(raw) ? raw : [raw];
    return items.map((item) => {
      if (!item || typeof item !== "object") return { name: null, agency: null, phone: null, email: null };
      const a = item as Record<string, unknown>;
      return {
        name: safeStr(a["name"] ?? a["legalName"]) ?? null,
        agency: safeStr((a["memberOf"] as Record<string, unknown>)?.["name"] ?? a["affiliation"]) ?? null,
        phone: safeStr(a["telephone"] ?? a["phone"]) ?? null,
        email: safeStr(a["email"]) ?? null,
      };
    });
  }

  private _score(data: Partial<Property>): number {
    let score = 0.35;
    if (data.fullAddress) score += 0.1;
    if (data.latitude) score += 0.1;
    if (data.price) score += 0.05;
    if (data.bedrooms != null) score += 0.05;
    if ((data.images?.length ?? 0) > 0) score += 0.05;
    if (data.description) score += 0.05;
    if (data.propertyId) score += 0.05;
    return Math.min(score, 0.85);
  }
}

import type { IParser, ParseResult, Property, AgentInfo, SaleHistoryEntry, PropertyType, ListingStatus } from "../types.js";
import { normalisePropertyType, normaliseStatus, parsePrice, parseSizeValue, safeStr, safeNum, safeFloat, collectStrings, extractIdFromUrl, deepGet } from "../utils.js";

void ({} as PropertyType); void ({} as ListingStatus);

export class NextDataParser implements IParser {
  canParse(html: string, _url: string): boolean {
    return html.includes("__NEXT_DATA__");
  }

  parse(html: string, url: string): ParseResult {
    const json = this._extractJson(html);
    if (!json) return { data: {}, confidence: 0 };
    try {
      const data = this._traverse(json, url);
      return { data, confidence: this._score(data) };
    } catch { return { data: {}, confidence: 0 }; }
  }

  private _extractJson(html: string): unknown | null {
    const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match?.[1]) return null;
    try { return JSON.parse(match[1]); } catch { return null; }
  }

  private _traverse(root: unknown, url: string): Partial<Property> {
    const listing = this._findListing(root as Record<string, unknown>);
    if (listing) return this._mapListing(listing, url, root as Record<string, unknown>);
    return this._mapFlat(root as Record<string, unknown>, url);
  }

  private _findListing(root: Record<string, unknown>): Record<string, unknown> | null {
    const paths = [
      ["props", "pageProps", "listing"],
      ["props", "pageProps", "listingDetails"],
      ["props", "pageProps", "property"],
      ["props", "pageProps", "propertyDetails"],
      ["props", "pageProps", "data", "listing"],
      ["props", "pageProps", "initialState", "listing"],
      ["props", "pageProps", "serverState", "listing"],
    ];
    for (const path of paths) {
      const node = deepGet(root, path);
      if (node && typeof node === "object" && !Array.isArray(node)) return node as Record<string, unknown>;
    }
    return this._searchForListing(root, 0);
  }

  private _searchForListing(node: unknown, depth: number): Record<string, unknown> | null {
    if (depth > 8 || typeof node !== "object" || node === null) return null;
    const obj = node as Record<string, unknown>;
    const hasListingKeys =
      ("address" in obj || "location" in obj) &&
      ("price" in obj || "priceDetails" in obj || "listingCompanyDetails" in obj);
    if (hasListingKeys) return obj;
    for (const val of Object.values(obj)) {
      const found = this._searchForListing(val, depth + 1);
      if (found) return found;
    }
    return null;
  }

  private _mapListing(l: Record<string, unknown>, url: string, root: Record<string, unknown>): Partial<Property> {
    const addr = (l["address"] ?? l["location"] ?? {}) as Record<string, unknown>;
    const price = (l["priceDetails"] ?? l["price"] ?? {}) as Record<string, unknown>;
    const media = (l["media"] ?? l["images"] ?? []) as unknown[];
    const geo = (l["geoLocation"] ?? l["geo"] ?? addr["geo"] ?? {}) as Record<string, unknown>;
    const agents = ((l["listers"] ?? l["agents"] ?? l["advertiser"] ?? []) as unknown[]);

    const rawPrice = safeStr(price["displayPrice"]) ?? safeStr(price["value"]) ?? safeStr(l["price"]) ?? safeStr(l["displayPrice"]) ?? "";
    const landNode = (l["landDetails"] ?? l["land"] ?? {}) as Record<string, unknown>;
    const { value: landVal, unit: landUnit } = parseSizeValue(safeStr(landNode["displayValue"] ?? landNode["value"] ?? l["landSize"]) ?? "");
    const buildNode = (l["buildingDetails"] ?? {}) as Record<string, unknown>;
    const { value: buildVal, unit: buildUnit } = parseSizeValue(safeStr(buildNode["displayValue"] ?? buildNode["value"] ?? l["buildingSize"]) ?? "");

    const streetNum = safeStr(addr["streetNumber"] ?? addr["street_number"]) ?? "";
    const streetName = safeStr(addr["street"] ?? addr["streetName"]) ?? "";
    const street = [streetNum, streetName].filter(Boolean).join(" ");
    const suburb = safeStr(addr["suburb"] ?? addr["locality"] ?? addr["city"]) ?? null;
    const state = safeStr(addr["state"] ?? addr["stateAbbreviation"]) ?? null;
    const postcode = safeStr(addr["postcode"] ?? addr["postalCode"]) ?? null;
    const fullAddress =
      safeStr(l["fullAddress"] ?? l["displayableAddress"] ?? addr["display"] ?? addr["displayAddress"]) ??
      ([street, suburb, state, postcode].filter(Boolean).join(", ") || null);

    const images = this._extractImages(media, l);
    const floorplans = this._extractFloorplans(media, l);
    const features = collectStrings(l["features"] ?? l["propertyFeatures"] ?? []);
    const agentInfos = this._extractAgents(agents, l);
    const saleHistory = this._extractHistory(l, root);
    const statusRaw = safeStr(l["status"] ?? l["listingStatus"] ?? l["channel"]) ?? "";
    const propertyTypeRaw = safeStr(l["propertyType"] ?? l["category"] ?? l["type"]) ?? "";

    return {
      propertyId: safeStr(l["id"] ?? l["listingId"] ?? l["propertyId"]) ?? extractIdFromUrl(url),
      url, fullAddress, street: street || null, suburb, state, postcode,
      price: rawPrice || null, priceNumeric: parsePrice(rawPrice),
      bedrooms: safeNum(l["bedrooms"] ?? l["beds"] ?? l["bedroom"]),
      bathrooms: safeNum(l["bathrooms"] ?? l["baths"] ?? l["bathroom"]),
      carSpaces: safeNum(l["carspaces"] ?? l["car"] ?? l["carSpaces"] ?? l["parking"]),
      landSize: landVal, landSizeUnit: landUnit, buildingSize: buildVal, buildingSizeUnit: buildUnit,
      propertyType: normalisePropertyType(propertyTypeRaw),
      images, floorplans,
      description: safeStr(l["description"] ?? l["propertyDescription"]) ?? null,
      features, agents: agentInfos,
      latitude: safeFloat(geo["latitude"] ?? geo["lat"]),
      longitude: safeFloat(geo["longitude"] ?? geo["lon"] ?? geo["lng"]),
      saleHistory, listingStatus: normaliseStatus(statusRaw),
      listingDate: safeStr(l["dateListed"] ?? l["listedDate"] ?? l["dateCreated"]) ?? null,
      lastUpdated: safeStr(l["dateUpdated"] ?? l["lastUpdated"]) ?? null,
      rawJson: l as Record<string, unknown>,
    };
  }

  private _mapFlat(flat: Record<string, unknown>, url: string): Partial<Property> {
    return {
      propertyId: safeStr(flat["id"] ?? flat["listingId"]) ?? extractIdFromUrl(url),
      url,
      fullAddress: safeStr(flat["fullAddress"] ?? flat["displayAddress"]) ?? null,
      price: safeStr(flat["displayPrice"] ?? flat["price"]) ?? null,
      bedrooms: safeNum(flat["bedrooms"] ?? flat["beds"]),
      bathrooms: safeNum(flat["bathrooms"] ?? flat["baths"]),
      carSpaces: safeNum(flat["carspaces"] ?? flat["carSpaces"]),
      listingStatus: normaliseStatus(safeStr(flat["status"] ?? flat["channel"]) ?? ""),
    };
  }

  private _extractImages(media: unknown[], listing: Record<string, unknown>): string[] {
    const urls: string[] = [];
    for (const item of media) {
      if (typeof item === "string" && item.startsWith("http")) urls.push(item);
      else if (typeof item === "object" && item !== null) {
        const m = item as Record<string, unknown>;
        const url = safeStr(m["url"] ?? m["src"] ?? m["href"] ?? m["imageUrl"]);
        if (url && !url.toLowerCase().includes("floorplan")) urls.push(url);
      }
    }
    const photos = listing["photos"] ?? listing["images"];
    if (Array.isArray(photos)) {
      for (const p of photos) {
        if (typeof p === "string") urls.push(p);
        else if (typeof p === "object" && p !== null) {
          const url = safeStr((p as Record<string, unknown>)["url"] ?? (p as Record<string, unknown>)["href"]);
          if (url) urls.push(url);
        }
      }
    }
    return [...new Set(urls)];
  }

  private _extractFloorplans(media: unknown[], listing: Record<string, unknown>): string[] {
    const urls: string[] = [];
    for (const item of media) {
      if (typeof item === "object" && item !== null) {
        const m = item as Record<string, unknown>;
        const type = safeStr(m["type"] ?? m["category"] ?? m["mediaType"]) ?? "";
        const url = safeStr(m["url"] ?? m["src"] ?? m["href"]);
        if (url && (type.toLowerCase().includes("floorplan") || url.toLowerCase().includes("floorplan"))) urls.push(url);
      }
    }
    const fp = listing["floorplans"] ?? listing["floorPlanImages"];
    if (Array.isArray(fp)) {
      for (const p of fp) {
        const url = typeof p === "string" ? p : safeStr((p as Record<string, unknown>)?.["url"]);
        if (url) urls.push(url);
      }
    }
    return [...new Set(urls)];
  }

  private _extractAgents(agents: unknown[], listing: Record<string, unknown>): AgentInfo[] {
    const result: AgentInfo[] = [];
    const list = agents.length ? agents : [listing["advertiser"] ?? listing["agent"]].filter(Boolean);
    for (const a of list) {
      if (!a || typeof a !== "object") continue;
      const agent = a as Record<string, unknown>;
      result.push({
        name: safeStr(agent["name"] ?? agent["agentName"] ?? agent["displayName"]) ?? null,
        agency: safeStr(agent["agency"] ?? agent["agencyName"] ?? agent["brandName"]) ?? null,
        phone: safeStr(agent["phone"] ?? agent["mobile"] ?? agent["telephone"]) ?? null,
        email: safeStr(agent["email"] ?? agent["emailAddress"]) ?? null,
      });
    }
    return result;
  }

  private _extractHistory(listing: Record<string, unknown>, root: Record<string, unknown>): SaleHistoryEntry[] {
    const raw = listing["saleHistory"] ?? listing["priceHistory"] ??
      deepGet(root, ["props", "pageProps", "saleHistory"]) ?? [];
    if (!Array.isArray(raw)) return [];
    return raw.map((e) => {
      const entry = e as Record<string, unknown>;
      return {
        date: safeStr(entry["date"] ?? entry["soldDate"]) ?? "",
        price: safeNum(entry["price"] ?? entry["soldPrice"]),
        type: safeStr(entry["type"] ?? entry["eventType"]) ?? "sale",
        agency: safeStr(entry["agency"]) ?? undefined,
      };
    });
  }

  private _score(data: Partial<Property>): number {
    let score = 0.5;
    if (data.fullAddress) score += 0.1;
    if (data.price != null) score += 0.05;
    if (data.bedrooms != null) score += 0.05;
    if (data.latitude) score += 0.05;
    if ((data.images?.length ?? 0) > 0) score += 0.05;
    if (data.description) score += 0.05;
    if (data.propertyId) score += 0.05;
    if ((data.agents?.length ?? 0) > 0) score += 0.05;
    if ((data.features?.length ?? 0) > 0) score += 0.05;
    return Math.min(score, 0.98);
  }
}

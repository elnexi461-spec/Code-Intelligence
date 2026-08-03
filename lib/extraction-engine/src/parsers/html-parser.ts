import * as cheerio from "cheerio";
import type { IParser, ParseResult, Property, AgentInfo } from "../types.js";
import { normalisePropertyType, normaliseStatus, parsePrice, parseSizeValue, safeNum, safeFloat, extractIdFromUrl, dedupe } from "../utils.js";

export class HtmlParser implements IParser {
  canParse(_html: string, _url: string): boolean { return true; }

  parse(html: string, url: string): ParseResult {
    const $ = cheerio.load(html);
    const data = this._extract($, html, url);
    return { data, confidence: this._score(data) };
  }

  private _extract($: cheerio.CheerioAPI, html: string, url: string): Partial<Property> {
    const fullAddress =
      this._text($, ['[data-testid="listing-summary-address"]', '[class*="address"]', 'h1[class*="address"]', '[itemprop="streetAddress"]', ".listing-address", ".property-address"]) ??
      ($("title").text().replace(/\s*[\|\-–]\s*.*$/, "").trim() || null);

    const { street, suburb, state, postcode } = this._parseAddress(fullAddress ?? "");
    const priceRaw = this._text($, ['[data-testid="listing-details__summary-title"]', '[data-testid="price"]', '[class*="price"]', '[itemprop="price"]', ".price"]) ?? "";

    const bedrooms = this._numFromSelectors($, ['[data-testid="property-features-text-bedrooms"]', '[class*="beds"]', '[aria-label*="bedroom" i]']) ?? this._featureIconNum($, "bed");
    const bathrooms = this._numFromSelectors($, ['[data-testid="property-features-text-bathrooms"]', '[class*="baths"]', '[aria-label*="bathroom" i]']) ?? this._featureIconNum($, "bath");
    const carSpaces = this._numFromSelectors($, ['[data-testid="property-features-text-parkingSpaces"]', '[class*="cars"]', '[aria-label*="car" i]']) ?? this._featureIconNum($, "car");

    const { value: landVal, unit: landUnit } = parseSizeValue(this._text($, ['[data-testid="property-features-text-landSize"]', '[class*="land-size"]']) ?? "");
    const { value: buildVal, unit: buildUnit } = parseSizeValue(this._text($, ['[data-testid="property-features-text-buildingSize"]', '[class*="building-size"]']) ?? "");

    const typeRaw = this._text($, ['[data-testid="listing-summary-property-type"]', '[class*="property-type"]']) ?? this._meta($, "og:type") ?? "";

    const images = this._images($, html);
    const floorplans = this._floorplans($, html);

    const description =
      this._text($, ['[data-testid="listing-details__description"]', '[class*="description"]', '[itemprop="description"]', ".property-description"]) ??
      this._meta($, "og:description") ?? null;

    const features: string[] = [];
    $('[data-testid="listing-details__additional-features-listing"] li, [class*="feature"] li, .features li').each((_i, el) => {
      const t = $(el).text().trim();
      if (t) features.push(t);
    });

    const agents = this._agents($);
    const { lat, lng } = this._geo($, html);
    const statusRaw = this._text($, ['[data-testid="listing-details__listing-type"]', '[class*="listing-status"]']) ?? url;
    const propertyId = this._meta($, "rea:listing:id") ?? extractIdFromUrl(url);

    return {
      propertyId, url,
      fullAddress: fullAddress || null, street: street || null, suburb: suburb || null, state: state || null, postcode: postcode || null,
      price: priceRaw || null, priceNumeric: parsePrice(priceRaw),
      bedrooms: bedrooms ?? null, bathrooms: bathrooms ?? null, carSpaces: carSpaces ?? null,
      landSize: landVal, landSizeUnit: landUnit, buildingSize: buildVal, buildingSizeUnit: buildUnit,
      propertyType: normalisePropertyType(typeRaw), images, floorplans, description,
      features: dedupe(features), agents,
      latitude: lat, longitude: lng,
      saleHistory: [], listingStatus: normaliseStatus(statusRaw),
      listingDate: null, lastUpdated: null, rawJson: null,
    };
  }

  private _text($: cheerio.CheerioAPI, selectors: string[]): string | null {
    for (const sel of selectors) {
      try { const t = $(sel).first().text().trim(); if (t) return t; } catch { /* skip */ }
    }
    return null;
  }

  private _meta($: cheerio.CheerioAPI, name: string): string | null {
    return ($(`meta[property="${name}"]`).attr("content") ?? $(`meta[name="${name}"]`).attr("content") ?? "").trim() || null;
  }

  private _numFromSelectors($: cheerio.CheerioAPI, selectors: string[]): number | null {
    for (const sel of selectors) {
      try {
        const t = $(sel).first().text().trim();
        const n = safeNum(t.match(/\d+/)?.[0] ?? t);
        if (n !== null) return n;
      } catch { /* skip */ }
    }
    return null;
  }

  private _featureIconNum($: cheerio.CheerioAPI, type: string): number | null {
    let val: number | null = null;
    $(`[class*="${type}"], [aria-label*="${type}" i]`).each((_i, el) => {
      if (val !== null) return;
      const text = $(el).text().trim() || $(el).attr("aria-label") || "";
      const m = text.match(/(\d+)/);
      if (m) val = parseInt(m[1], 10);
    });
    return val;
  }

  private _images($: cheerio.CheerioAPI, html: string): string[] {
    const urls = new Set<string>();
    const ogImage = $('meta[property="og:image"]').attr("content");
    if (ogImage) urls.add(ogImage);
    $('[data-testid*="image"] img, [class*="gallery"] img, [class*="carousel"] img, [class*="photo"] img').each((_i, el) => {
      const src = $(el).attr("src") ?? $(el).attr("data-src");
      if (src && src.startsWith("http") && !src.toLowerCase().includes("floorplan")) urls.add(src);
    });
    const pat = /["'](https:\/\/[^"']+\.(?:jpg|jpeg|webp|png)(?:\?[^"']*)?)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(html)) !== null) {
      const u = m[1];
      if (u && !u.toLowerCase().includes("floorplan") && !u.includes("logo") && !u.includes("icon") && !u.includes("avatar") && !u.includes("/agent")) urls.add(u);
    }
    return [...urls].slice(0, 50);
  }

  private _floorplans($: cheerio.CheerioAPI, html: string): string[] {
    const urls = new Set<string>();
    $('[class*="floorplan"] img, [data-testid*="floorplan"] img').each((_i, el) => {
      const src = $(el).attr("src") ?? $(el).attr("data-src");
      if (src) urls.add(src);
    });
    const pat = /["'](https:\/\/[^"']*floorplan[^"']*\.(?:jpg|jpeg|webp|png)(?:\?[^"']*)?)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(html)) !== null) { if (m[1]) urls.add(m[1]); }
    return [...urls];
  }

  private _agents($: cheerio.CheerioAPI): AgentInfo[] {
    const agents: AgentInfo[] = [];
    $('[data-testid*="agent"], [class*="agent-card"], [class*="agent-details"]').each((_i, el) => {
      const name = $('[class*="agent-name"], [data-testid*="agent-name"]', el).first().text().trim() || null;
      const agency = $('[class*="agency-name"], [class*="agent-agency"]', el).first().text().trim() || null;
      const phone = $('a[href^="tel:"]', el).first().text().trim() || $('a[href^="tel:"]', el).first().attr("href")?.replace("tel:", "") || null;
      const email = $('a[href^="mailto:"]', el).first().attr("href")?.replace("mailto:", "") || null;
      if (name || agency || phone) agents.push({ name, agency, phone: phone ?? null, email: email ?? null });
    });
    return agents;
  }

  private _geo($: cheerio.CheerioAPI, html: string): { lat: number | null; lng: number | null } {
    const lat = safeFloat($('[itemprop="latitude"]').attr("content"));
    const lng = safeFloat($('[itemprop="longitude"]').attr("content"));
    if (lat && lng) return { lat, lng };
    const mapEl = $("[data-lat], [data-latitude]").first();
    if (mapEl.length) {
      const dlat = safeFloat(mapEl.attr("data-lat") ?? mapEl.attr("data-latitude"));
      const dlng = safeFloat(mapEl.attr("data-lng") ?? mapEl.attr("data-longitude"));
      if (dlat && dlng) return { lat: dlat, lng: dlng };
    }
    const m = html.match(/["']?(?:latitude|lat)["']?\s*:\s*([-\d.]+)\D{0,30}["']?(?:longitude|lng|lon)["']?\s*:\s*([-\d.]+)/i);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
    return { lat: null, lng: null };
  }

  private _parseAddress(addr: string): { street: string; suburb: string; state: string; postcode: string } {
    if (!addr) return { street: "", suburb: "", state: "", postcode: "" };
    const m = addr.match(/^(.+?),?\s+([^,]+?)\s+([A-Z]{2,3})\s+(\d{4})\s*$/);
    if (m) return { street: m[1]?.trim() ?? "", suburb: m[2]?.trim() ?? "", state: m[3]?.trim() ?? "", postcode: m[4]?.trim() ?? "" };
    const parts = addr.split(",").map((p) => p.trim());
    return { street: parts[0] ?? "", suburb: parts[1] ?? "", state: "", postcode: "" };
  }

  private _score(data: Partial<Property>): number {
    let score = 0.2;
    if (data.fullAddress) score += 0.1;
    if (data.price) score += 0.05;
    if (data.bedrooms != null) score += 0.05;
    if ((data.images?.length ?? 0) > 0) score += 0.05;
    if (data.description) score += 0.05;
    if (data.latitude) score += 0.05;
    if (data.propertyId) score += 0.05;
    return Math.min(score, 0.65);
  }
}

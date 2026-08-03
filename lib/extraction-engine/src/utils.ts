import type { PropertyType, ListingStatus } from "./types.js";

export function normalisePropertyType(raw: string): PropertyType {
  const s = raw.toLowerCase();
  if (s.includes("house") || s.includes("home")) return "house";
  if (s.includes("apartment") || s.includes("flat")) return "apartment";
  if (s.includes("unit")) return "unit";
  if (s.includes("townhouse") || s.includes("town house")) return "townhouse";
  if (s.includes("villa")) return "villa";
  if (s.includes("land") || s.includes("block") || s.includes("lot")) return "land";
  if (s.includes("rural") || s.includes("acreage") || s.includes("farm")) return "rural";
  if (s.includes("commercial") || s.includes("retail") || s.includes("industrial")) return "commercial";
  if (raw) return "other";
  return "unknown";
}

export function normaliseStatus(raw: string): ListingStatus {
  const s = raw.toLowerCase();
  if (s.includes("sold")) return "sold";
  if (s.includes("leased") || s.includes("rented")) return "leased";
  if (s.includes("rent") || s.includes("lease")) return "for-rent";
  if (s.includes("sale") || s.includes("buy") || s === "residential") return "for-sale";
  if (s.includes("off") || s.includes("withdrawn")) return "off-market";
  return "unknown";
}

export interface SizeResult { value: number | null; unit: string | null; }

export function parseSizeValue(raw: string): SizeResult {
  if (!raw) return { value: null, unit: null };
  const m = raw.match(/([\d,]+(?:\.\d+)?)\s*(m²|sqm|ha|acres?|m2)?/i);
  if (!m) return { value: null, unit: null };
  const value = parseFloat(m[1].replace(/,/g, ""));
  const unit = m[2]?.toLowerCase().replace("m²", "sqm") ?? "sqm";
  return { value: isNaN(value) ? null : value, unit };
}

export function parsePrice(raw: string): number | null {
  if (!raw) return null;
  const clean = raw.replace(/[^0-9.]/g, " ").trim();
  const m = clean.match(/\d[\d,.]*/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

export function safeStr(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

export function safeNum(v: unknown): number | null {
  if (typeof v === "number" && !isNaN(v)) return Math.round(v);
  if (typeof v === "string") { const n = parseInt(v, 10); return isNaN(n) ? null : n; }
  return null;
}

export function safeFloat(v: unknown): number | null {
  if (typeof v === "number" && !isNaN(v)) return v;
  if (typeof v === "string") { const n = parseFloat(v); return isNaN(n) ? null : n; }
  return null;
}

export function extractIdFromUrl(url: string): string | null {
  const m = url.match(/\/property\/([^/?#]+)/i) ?? url.match(/-(\d{6,})(?:\/|$|\?)/);
  return m?.[1] ?? null;
}

export function collectStrings(v: unknown): string[] {
  if (!v) return [];
  if (typeof v === "string") return v ? [v] : [];
  if (Array.isArray(v)) {
    return v.flatMap((item) => {
      if (typeof item === "string") return item ? [item] : [];
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        const name = obj["name"] ?? obj["label"] ?? obj["value"] ?? obj["text"];
        return typeof name === "string" && name ? [name] : [];
      }
      return [];
    });
  }
  return [];
}

export function deepGet(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function dedupe(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

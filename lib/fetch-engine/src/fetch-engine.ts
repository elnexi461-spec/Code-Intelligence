import { Pool, Agent, setGlobalDispatcher, fetch as undiciFetch } from "undici";
import { createGunzip, createBrotliDecompress, createInflate } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import type { Readable } from "node:stream";
import type {
  FetchRequest,
  FetchResponse,
  RequestMetrics,
  FetchEngineConfig,
  ILogger,
  IConfigManager,
} from "./types.js";
import { ConfigManager } from "./config-manager.js";
import { SessionManager } from "./session-manager.js";
import { RateLimiter } from "./rate-limiter.js";

const CF_BLOCK_STATUSES = new Set([403, 429, 503]);
const CF_HEADERS = ["cf-ray", "cf-mitigated", "cf-cache-status"];

function isCloudflareBlocked(status: number, headers: Record<string, string>): boolean {
  if (!CF_BLOCK_STATUSES.has(status)) return false;
  return CF_HEADERS.some((h) => h in headers);
}

function cloudflareSafeHeaders(): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
  };
}

function originOf(url: string): string {
  try { const u = new URL(url); return `${u.protocol}//${u.host}`; }
  catch { throw new Error(`FetchEngine: invalid URL "${url}"`); }
}

function decompressStream(encoding: string | undefined, source: Readable): Readable {
  if (!encoding) return source;
  const enc = encoding.toLowerCase();
  if (enc === "gzip" || enc === "x-gzip") { const g = createGunzip(); source.pipe(g); return g; }
  if (enc === "br") { const b = createBrotliDecompress(); source.pipe(b); return b; }
  if (enc === "deflate") { const i = createInflate(); source.pipe(i); return i; }
  return source;
}

async function collectBody(stream: Readable): Promise<{ text: string; bytes: number }> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  await pipeline(stream, new Writable({ write(chunk: Buffer, _enc, cb) { chunks.push(chunk); bytes += chunk.length; cb(); } }));
  return { text: Buffer.concat(chunks).toString("utf8"), bytes };
}

export class FetchEngine {
  private readonly cfg: {
    baseUrl: string; defaultTimeoutMs: number; maxConnectionsPerOrigin: number;
    followRedirects: boolean; maxRedirects: number; decompress: boolean;
    keepAlive: boolean; keepAliveTimeoutMs: number; http2: boolean;
    defaultHeaders: Record<string, string>;
  } & FetchEngineConfig;

  private readonly pools = new Map<string, Pool>();
  private readonly logger: ILogger;
  private readonly sessionMgr: SessionManager;
  private readonly rateLimiter: RateLimiter;
  private readonly configMgr: IConfigManager;

  constructor(config: FetchEngineConfig = {}, configMgr?: IConfigManager, logger?: ILogger) {
    this.configMgr = configMgr ?? new ConfigManager();
    this.cfg = {
      baseUrl: config.baseUrl ?? this.configMgr.get<string>("baseUrl", ""),
      defaultTimeoutMs: config.defaultTimeoutMs ?? this.configMgr.get<number>("defaultTimeoutMs", 30_000),
      maxConnectionsPerOrigin: config.maxConnectionsPerOrigin ?? this.configMgr.get<number>("maxConnectionsPerOrigin", 10),
      followRedirects: config.followRedirects ?? this.configMgr.get<boolean>("followRedirects", true),
      maxRedirects: config.maxRedirects ?? this.configMgr.get<number>("maxRedirects", 10),
      decompress: config.decompress ?? this.configMgr.get<boolean>("decompress", true),
      keepAlive: config.keepAlive ?? this.configMgr.get<boolean>("keepAlive", true),
      keepAliveTimeoutMs: config.keepAliveTimeoutMs ?? this.configMgr.get<number>("keepAliveTimeoutMs", 60_000),
      http2: config.http2 ?? this.configMgr.get<boolean>("http2", true),
      defaultHeaders: config.defaultHeaders ?? {},
      onRetry: config.onRetry, onProxy: config.onProxy,
      onRequest: config.onRequest, onResponse: config.onResponse,
      rateLimiter: config.rateLimiter, sessionManager: config.sessionManager,
    };
    this.logger = logger ?? {
      debug: (obj: Record<string, unknown>, msg?: string) => console.debug(msg ?? "", obj),
      info: (obj: Record<string, unknown>, msg?: string) => console.info(msg ?? "", obj),
      warn: (obj: Record<string, unknown>, msg?: string) => console.warn(msg ?? "", obj),
      error: (obj: Record<string, unknown>, msg?: string) => console.error(msg ?? "", obj),
    };
    this.sessionMgr = (config.sessionManager as SessionManager | undefined) ?? new SessionManager();
    this.rateLimiter = (config.rateLimiter as RateLimiter | undefined) ?? new RateLimiter(10);
    setGlobalDispatcher(new Agent({
      allowH2: this.cfg.http2,
      keepAliveTimeout: this.cfg.keepAliveTimeoutMs,
      keepAliveMaxTimeout: this.cfg.keepAliveTimeoutMs * 3,
    }));
  }

  private getPool(origin: string): Pool {
    let pool = this.pools.get(origin);
    if (!pool) {
      pool = new Pool(origin, {
        connections: this.cfg.maxConnectionsPerOrigin,
        allowH2: this.cfg.http2,
        keepAliveTimeout: this.cfg.keepAlive ? this.cfg.keepAliveTimeoutMs : 0,
        keepAliveMaxTimeout: this.cfg.keepAlive ? this.cfg.keepAliveTimeoutMs * 3 : 0,
      });
      this.pools.set(origin, pool);
    }
    return pool;
  }

  async fetch(req: FetchRequest): Promise<FetchResponse> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let lastRes: FetchResponse | null = null;
      let lastErr: Error | null = null;
      try { lastRes = await this._dispatch(req, attempt); }
      catch (err) { lastErr = err instanceof Error ? err : new Error(String(err)); }
      if (this.cfg.onRetry) {
        const decision = await this.cfg.onRetry(req, lastRes, lastErr, attempt);
        if (decision.retry) {
          attempt++;
          if (decision.delayMs > 0) await delay(decision.delayMs);
          this.logger.debug({ url: req.url, attempt }, "retrying request");
          continue;
        }
      }
      if (lastErr) throw lastErr;
      return lastRes!;
    }
  }

  private async _dispatch(reqIn: FetchRequest, attempt: number): Promise<FetchResponse> {
    const req = this.cfg.onRequest ? await this.cfg.onRequest(reqIn) : reqIn;
    const resolvedUrl = req.url.startsWith("http") ? req.url : `${this.cfg.baseUrl}${req.url}`;
    const origin = originOf(resolvedUrl);
    const timeout = req.timeout ?? this.cfg.defaultTimeoutMs;
    const startedAt = Date.now();

    await this.rateLimiter.acquire(origin);

    let proxyUrl: string | null = null;
    if (this.cfg.onProxy) proxyUrl = await this.cfg.onProxy(req);

    const ua = this.sessionMgr.getUserAgent(req.sessionId);
    const cookies = this.sessionMgr.getCookies(resolvedUrl, req.sessionId);
    const requestHeaders: Record<string, string> = {
      ...cloudflareSafeHeaders(), ...this.cfg.defaultHeaders,
      "User-Agent": ua,
      ...(cookies ? { Cookie: cookies } : {}),
      ...(req.headers ?? {}),
    };

    let bytesSent = 0;
    if (req.body) {
      if (typeof req.body === "string") bytesSent = Buffer.byteLength(req.body, "utf8");
      else if (req.body instanceof Buffer) bytesSent = req.body.length;
    }

    this.logger.debug({ url: resolvedUrl, method: req.method ?? "GET", attempt, proxy: proxyUrl }, "dispatching request");

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchOpts: any = {
      method: req.method ?? "GET",
      headers: requestHeaders,
      body: req.body ?? null,
      redirect: this.cfg.followRedirects ? "follow" : "manual",
      signal: ac.signal,
      dispatcher: this.getPool(origin),
    };

    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try { response = await undiciFetch(resolvedUrl, fetchOpts); }
    finally { clearTimeout(timer); }

    const ttfbMs = Date.now() - startedAt;
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

    const setCookieHeader = headers["set-cookie"];
    if (setCookieHeader) this.sessionMgr.setCookies(resolvedUrl, [setCookieHeader], req.sessionId);

    const metrics: RequestMetrics = {
      startedAt, ttfbMs, totalMs: 0, bytesReceived: 0, bytesSent,
      redirectCount: this.cfg.followRedirects && response.redirected ? 1 : 0,
      retryCount: attempt, fromCache: headers["x-cache"]?.toLowerCase().includes("hit") ?? false,
      httpVersion: "2.0",
    };

    if (req.stream) {
      const nodeStream = response.body ? (response.body as unknown as Readable) : null;
      let streamOut: Readable | undefined;
      if (nodeStream) streamOut = this.cfg.decompress ? decompressStream(headers["content-encoding"], nodeStream) : nodeStream;
      metrics.totalMs = Date.now() - startedAt;
      const res: FetchResponse = {
        url: response.url || resolvedUrl, status: response.status, statusText: response.statusText,
        headers, body: "", stream: streamOut, metrics, ok: response.ok,
        cloudflareBlocked: isCloudflareBlocked(response.status, headers),
      };
      this.rateLimiter.release(origin);
      if (res.cloudflareBlocked) this.logger.warn({ url: resolvedUrl, status: response.status }, "cloudflare block detected");
      return this.cfg.onResponse ? this.cfg.onResponse(req, res) : res;
    }

    const rawText = await response.text();
    const bytesReceived = Buffer.byteLength(rawText, "utf8");
    metrics.bytesReceived = bytesReceived;
    metrics.totalMs = Date.now() - startedAt;
    this.rateLimiter.release(origin);

    this.logger.debug({ url: resolvedUrl, status: response.status, bytes: bytesReceived, totalMs: metrics.totalMs }, "response received");

    const res: FetchResponse = {
      url: response.url || resolvedUrl, status: response.status, statusText: response.statusText,
      headers, body: rawText, metrics, ok: response.ok,
      cloudflareBlocked: isCloudflareBlocked(response.status, headers),
    };
    if (res.cloudflareBlocked) this.logger.warn({ url: resolvedUrl, status: response.status }, "cloudflare block detected");
    return this.cfg.onResponse ? this.cfg.onResponse(req, res) : res;

    // suppress unused
    void decompressStream; void collectBody;
  }

  get(url: string, opts: Omit<FetchRequest, "url" | "method"> = {}): Promise<FetchResponse> {
    return this.fetch({ ...opts, url, method: "GET" });
  }
  post(url: string, body: string | Buffer, opts: Omit<FetchRequest, "url" | "method" | "body"> = {}): Promise<FetchResponse> {
    return this.fetch({ ...opts, url, method: "POST", body });
  }
  head(url: string, opts: Omit<FetchRequest, "url" | "method"> = {}): Promise<FetchResponse> {
    return this.fetch({ ...opts, url, method: "HEAD" });
  }
  stream(url: string, opts: Omit<FetchRequest, "url" | "stream"> = {}): Promise<FetchResponse> {
    return this.fetch({ ...opts, url, stream: true });
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.pools.values()].map((p) => p.close()));
    this.pools.clear();
    this.logger.info({}, "FetchEngine closed all connection pools");
  }
  async destroy(): Promise<void> {
    await Promise.allSettled([...this.pools.values()].map((p) => p.destroy()));
    this.pools.clear();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

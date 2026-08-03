import { Agent, request as undiciRequest } from 'undici';
import { createSecureContext } from 'node:tls';
import type { FetchRequest, FetchResponse } from './types.js';
import type { SessionManager } from './SessionManager.js';
import type { TlsProfiler } from './TlsProfiler.js';
import type { HeaderBuilder } from './HeaderBuilder.js';
import type { ProxyManager } from './ProxyManager.js';
import { FetchError, TimeoutError, BotDetectedError, RateLimitError } from '../errors/error-types.js';
import { getLogger } from '../logger/Logger.js';

// Pool of undici Agents keyed by origin
const agentPool = new Map<string, Agent>();

function getAgent(origin: string, tlsCiphers?: string, tlsSigalgs?: string): Agent {
  const key = `${origin}::${tlsCiphers ?? 'default'}`;
  let agent = agentPool.get(key);
  if (!agent) {
    const secureContext = tlsCiphers
      ? createSecureContext({ ciphers: tlsCiphers, sigalgs: tlsSigalgs })
      : undefined;

    agent = new Agent({
      connections: 10,
      pipelining: 1,
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 600_000,
      connect: secureContext
        ? { secureContext, ALPNProtocols: ['h2', 'http/1.1'] }
        : { ALPNProtocols: ['h2', 'http/1.1'] },
    });
    agentPool.set(key, agent);
  }
  return agent;
}

export class HttpFetcher {
  private readonly log = getLogger();

  constructor(
    private readonly sessions: SessionManager,
    private readonly tlsProfiler: TlsProfiler,
    private readonly headerBuilder: HeaderBuilder,
    private readonly proxyManager: ProxyManager,
  ) {}

  async fetch(req: FetchRequest): Promise<FetchResponse> {
    const session = this.sessions.getOrCreate(req.sessionId);
    const tlsProfile = this.tlsProfiler.getProfile(session.tlsProfileId);
    const cookieHeader = await this.sessions.getCookieString(session.id, req.url);

    const headers = this.headerBuilder.build({
      url: req.url,
      userAgent: session.userAgent,
      cookieHeader: cookieHeader || undefined,
      isXhr: req.method === 'POST',
    });

    // Merge any caller-supplied headers (they take precedence)
    const finalHeaders = { ...headers, ...(req.headers ?? {}) };

    const origin = new URL(req.url).origin;
    const agent = getAgent(origin, tlsProfile.ciphers, tlsProfile.sigalgs);

    const proxyUrl = req.proxyUrl ?? this.proxyManager.acquire();

    const start = Date.now();
    const controller = new AbortController();
    const timeoutMs = req.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await undiciRequest(req.url, {
        method: req.method ?? 'GET',
        headers: finalHeaders,
        body: req.body ?? null,
        dispatcher: proxyUrl ? await this.buildProxyAgent(proxyUrl, tlsProfile.ciphers) : agent,
        signal: controller.signal,
      });

      const durationMs = Date.now() - start;
      const body = await response.body.text();

      // Parse and store cookies
      const setCookieHeaders = response.headers['set-cookie'];
      if (setCookieHeaders) {
        const cookieList = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
        await this.sessions.setCookies(session.id, req.url, cookieList);
      }

      this.sessions.recordRequest(session.id);
      if (proxyUrl) this.proxyManager.recordSuccess(proxyUrl);

      const statusCode = response.statusCode;
      this.log.debug({ url: req.url, statusCode, durationMs }, 'fetched');

      if (statusCode === 429) {
        const retryAfter = response.headers['retry-after'];
        const retryAfterMs = retryAfter ? parseInt(String(retryAfter)) * 1000 : undefined;
        throw new RateLimitError(req.url, retryAfterMs);
      }

      if (statusCode === 403 || (statusCode === 200 && this.isBotPage(body))) {
        this.sessions.markBurned(session.id);
        if (proxyUrl) this.proxyManager.recordFailure(proxyUrl);
        throw new BotDetectedError(req.url, `status=${statusCode}`);
      }

      if (statusCode >= 400) {
        throw new FetchError(`HTTP ${statusCode}`, statusCode, req.url);
      }

      const responseHeaders: Record<string, string> = {};
      for (const [k, v] of Object.entries(response.headers)) {
        if (v !== undefined) responseHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v);
      }

      return {
        url: req.url,
        statusCode,
        headers: responseHeaders,
        body,
        durationMs,
        sessionId: session.id,
        fromCache: false,
      };
    } catch (err: unknown) {
      if (proxyUrl) this.proxyManager.recordFailure(proxyUrl);
      if ((err as Error)?.name === 'AbortError') {
        throw new TimeoutError(req.url, timeoutMs);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private isBotPage(body: string): boolean {
    const lower = body.toLowerCase();
    return (
      lower.includes('cf-browser-verification') ||
      lower.includes('enable javascript') ||
      lower.includes('checking your browser') ||
      (lower.includes('cloudflare') && lower.includes('ray id') && body.length < 5000)
    );
  }

  private async buildProxyAgent(proxyUrl: string, ciphers?: string): Promise<import('undici').ProxyAgent> {
    const { ProxyAgent } = await import('undici');
    const secureContext = ciphers ? createSecureContext({ ciphers }) : undefined;
    return new ProxyAgent({
      uri: proxyUrl,
      connect: secureContext ? { secureContext } : undefined,
    });
  }
}

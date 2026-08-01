import { CookieJar } from 'tough-cookie';
import { randomUUID } from 'node:crypto';
import type { Session } from './types.js';
import type { TlsProfiler } from './TlsProfiler.js';
import type { FetchConfig } from '../config/types.js';

const SESSION_MAX_REQUESTS = 500;
const SESSION_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private sessionQueue: string[] = []; // round-robin queue of healthy session IDs

  constructor(
    private readonly config: FetchConfig,
    private readonly tlsProfiler: TlsProfiler,
  ) {}

  getOrCreate(sessionId?: string): Session {
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing && !this.isExpired(existing)) return existing;
    }

    // Return a healthy session from the pool
    const healthy = this.getHealthySession();
    if (healthy) return healthy;

    return this.createSession();
  }

  markBurned(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.burned = true;
      this.sessions.delete(sessionId);
      this.sessionQueue = this.sessionQueue.filter(id => id !== sessionId);
    }
  }

  recordRequest(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.requestCount++;
      session.lastUsedAt = Date.now();
      if (session.requestCount >= SESSION_MAX_REQUESTS) {
        this.markBurned(sessionId);
      }
    }
  }

  async getCookieString(sessionId: string, url: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) return '';
    return session.cookieJar.getCookieString(url);
  }

  async setCookies(sessionId: string, url: string, setCookieHeaders: string[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const header of setCookieHeaders) {
      try {
        await session.cookieJar.setCookie(header, url);
      } catch {
        // Ignore malformed cookies
      }
    }
  }

  private createSession(): Session {
    const profile = this.tlsProfiler.getProfile();
    const uas = this.config.userAgents;
    const userAgent = uas[Math.floor(Math.random() * uas.length)] ?? uas[0]!;

    const session: Session = {
      id: randomUUID(),
      cookieJar: new CookieJar(),
      userAgent,
      tlsProfileId: profile.id,
      proxyUrl: null,
      requestCount: 0,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      burned: false,
    };

    this.sessions.set(session.id, session);
    this.sessionQueue.push(session.id);
    return session;
  }

  private getHealthySession(): Session | null {
    for (let i = 0; i < this.sessionQueue.length; i++) {
      const id = this.sessionQueue.shift()!;
      const session = this.sessions.get(id);
      if (session && !session.burned && !this.isExpired(session)) {
        this.sessionQueue.push(id); // move to end for round-robin
        return session;
      }
    }
    return null;
  }

  private isExpired(session: Session): boolean {
    return Date.now() - session.createdAt > SESSION_MAX_AGE_MS;
  }

  get activeCount(): number {
    return this.sessions.size;
  }
}

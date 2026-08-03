import { CookieJar } from "tough-cookie";
import type { ISessionManager } from "./types.js";

const DEFAULT_USER_AGENTS: string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
];

interface Session {
  jar: CookieJar;
  uaIndex: number;
  createdAt: number;
}

export class SessionManager implements ISessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly userAgents: string[];
  private globalUaIndex = 0;

  constructor(userAgents: string[] = DEFAULT_USER_AGENTS) {
    if (userAgents.length === 0) throw new Error("SessionManager: userAgents list must not be empty");
    this.userAgents = userAgents;
  }

  private getOrCreate(sessionId: string): Session {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { jar: new CookieJar(), uaIndex: this.globalUaIndex++ % this.userAgents.length, createdAt: Date.now() };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  getUserAgent(sessionId?: string): string {
    if (sessionId) {
      const session = this.getOrCreate(sessionId);
      return this.userAgents[session.uaIndex % this.userAgents.length]!;
    }
    return this.userAgents[this.globalUaIndex++ % this.userAgents.length]!;
  }

  getCookies(url: string, sessionId?: string): string {
    if (!sessionId) return "";
    const session = this.getOrCreate(sessionId);
    return session.jar.getCookiesSync(url).map((c) => c.cookieString()).join("; ");
  }

  setCookies(url: string, setCookieHeaders: string[], sessionId?: string): void {
    if (!sessionId || setCookieHeaders.length === 0) return;
    const session = this.getOrCreate(sessionId);
    for (const header of setCookieHeaders) {
      try { session.jar.setCookieSync(header, url); } catch { /* ignore malformed */ }
    }
  }

  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  get sessionCount(): number { return this.sessions.size; }

  purgeStaleSessions(maxAgeMs: number): number {
    const now = Date.now();
    let purged = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > maxAgeMs) { this.sessions.delete(id); purged++; }
    }
    return purged;
  }
}

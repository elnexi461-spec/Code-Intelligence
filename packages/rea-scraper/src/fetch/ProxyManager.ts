import type { ProxyConfig } from '../config/types.js';
import type { ProxyEntry } from './types.js';
import { ProxyError } from '../errors/error-types.js';

const MAX_FAILURES_BEFORE_BAN = 5;
const BAN_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export class ProxyManager {
  private proxies: ProxyEntry[] = [];
  private index = 0;

  constructor(configs: ProxyConfig[]) {
    this.proxies = configs.map(c => ({
      url: c.url,
      protocol: c.protocol,
      failures: 0,
      lastUsed: 0,
      banned: false,
    }));
  }

  /**
   * Returns the next healthy proxy URL, or null if no proxies configured.
   */
  acquire(): string | null {
    if (this.proxies.length === 0) return null;

    const healthy = this.getHealthy();
    if (!healthy) {
      // Unban proxies past their cooldown and retry
      this.unbanExpired();
      const retry = this.getHealthy();
      if (!retry) throw new ProxyError('All proxies are banned or unavailable');
      retry.lastUsed = Date.now();
      return retry.url;
    }

    healthy.lastUsed = Date.now();
    return healthy.url;
  }

  recordSuccess(proxyUrl: string): void {
    const entry = this.find(proxyUrl);
    if (entry) entry.failures = Math.max(0, entry.failures - 1);
  }

  recordFailure(proxyUrl: string): void {
    const entry = this.find(proxyUrl);
    if (!entry) return;
    entry.failures++;
    if (entry.failures >= MAX_FAILURES_BEFORE_BAN) {
      entry.banned = true;
      entry.lastUsed = Date.now(); // use lastUsed as ban timestamp
    }
  }

  ban(proxyUrl: string): void {
    const entry = this.find(proxyUrl);
    if (entry) {
      entry.banned = true;
      entry.lastUsed = Date.now();
    }
  }

  get hasProxies(): boolean {
    return this.proxies.length > 0;
  }

  get stats(): { total: number; healthy: number; banned: number } {
    const banned = this.proxies.filter(p => p.banned).length;
    return { total: this.proxies.length, healthy: this.proxies.length - banned, banned };
  }

  private getHealthy(): ProxyEntry | null {
    const healthy = this.proxies.filter(p => !p.banned);
    if (healthy.length === 0) return null;
    const entry = healthy[this.index % healthy.length]!;
    this.index++;
    return entry;
  }

  private find(url: string): ProxyEntry | undefined {
    return this.proxies.find(p => p.url === url);
  }

  private unbanExpired(): void {
    const now = Date.now();
    for (const p of this.proxies) {
      if (p.banned && now - p.lastUsed > BAN_COOLDOWN_MS) {
        p.banned = false;
        p.failures = 0;
      }
    }
  }
}

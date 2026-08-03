export interface FetchRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  sessionId?: string;
  proxyUrl?: string;
}

export interface FetchResponse {
  url: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  sessionId: string;
  fromCache: boolean;
}

export interface Session {
  id: string;
  cookieJar: import('tough-cookie').CookieJar;
  userAgent: string;
  tlsProfileId: string;
  proxyUrl: string | null;
  requestCount: number;
  createdAt: number;
  lastUsedAt: number;
  burned: boolean;
}

export interface TlsProfile {
  id: string;
  ciphers: string;
  sigalgs: string;
  minVersion: 'TLSv1.2' | 'TLSv1.3';
  maxVersion: 'TLSv1.2' | 'TLSv1.3';
}

export interface ProxyEntry {
  url: string;
  protocol: 'http' | 'socks5';
  failures: number;
  lastUsed: number;
  banned: boolean;
}

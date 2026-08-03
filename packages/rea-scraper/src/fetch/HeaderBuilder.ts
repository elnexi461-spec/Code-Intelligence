/**
 * Builds a realistic, ordered Chrome browser header set.
 * Header ORDER matters for TLS fingerprinting — match real browser wire order.
 */
export class HeaderBuilder {
  /**
   * Returns headers that mimic a real Chrome browser for a given URL.
   * Order is significant — do not sort or reorder.
   */
  build(params: {
    url: string;
    userAgent: string;
    cookieHeader?: string;
    referer?: string;
    isXhr?: boolean;
  }): Record<string, string> {
    const { url, userAgent, cookieHeader, referer, isXhr } = params;
    const origin = new URL(url).origin;

    const headers: Record<string, string> = {
      'accept': isXhr
        ? 'application/json, text/plain, */*'
        : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'accept-language': 'en-AU,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
      'accept-encoding': 'gzip, deflate, br, zstd',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': isXhr ? 'empty' : 'document',
      'sec-fetch-mode': isXhr ? 'cors' : 'navigate',
      'sec-fetch-site': referer ? 'same-origin' : 'none',
      'sec-fetch-user': isXhr ? undefined : '?1',
      'upgrade-insecure-requests': isXhr ? undefined : '1',
      'user-agent': userAgent,
    } as Record<string, string>;

    if (referer) {
      headers['referer'] = referer;
      headers['origin'] = origin;
    }

    if (cookieHeader) {
      headers['cookie'] = cookieHeader;
    }

    // Remove undefined values
    for (const key of Object.keys(headers)) {
      if (headers[key] === undefined) delete headers[key];
    }

    return headers;
  }

  /**
   * Headers for GraphQL POST requests.
   */
  buildGraphQL(params: {
    userAgent: string;
    cookieHeader?: string;
    callerId: string;
  }): Record<string, string> {
    return {
      'accept': '*/*',
      'accept-language': 'en-AU,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
      'accept-encoding': 'gzip, deflate, br',
      'content-type': 'application/json',
      'x-caller-id': params.callerId,
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
      'user-agent': params.userAgent,
      ...(params.cookieHeader ? { cookie: params.cookieHeader } : {}),
    };
  }
}

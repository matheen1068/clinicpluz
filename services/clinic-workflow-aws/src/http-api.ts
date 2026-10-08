import type { HttpInput, HttpResult } from './core.js';

export interface HttpApiEvent {
  version?: string;
  rawPath?: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
}

export function fromHttpApiEvent(event: HttpApiEvent): HttpInput | null {
  if (event.version !== '2.0' || !event.rawPath || !event.requestContext?.http?.method) return null;
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    const key = name.toLowerCase();
    if (Object.hasOwn(headers, key)) return null;
    headers[key] = value;
  }
  if (event.cookies && (!Array.isArray(event.cookies) || event.cookies.some((cookie) => typeof cookie !== 'string'))) return null;
  return { method: event.requestContext.http.method.toUpperCase(), path: event.rawPath,
    queryString: event.rawQueryString, headers, cookies: event.cookies,
    body: event.body, isBase64Encoded: event.isBase64Encoded };
}

export function invalidHttpApiEvent(): HttpResult {
  return { statusCode: 400, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: '{"error":"Invalid request"}' };
}

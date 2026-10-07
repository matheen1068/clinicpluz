import type { HttpInput, HttpResult } from './core.js';

export interface HttpApiEvent {
  version?: string;
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: { method?: string };
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
}

export function fromHttpApiEvent(event: HttpApiEvent): HttpInput | null {
  if (event.version !== '2.0' || !event.rawPath || !event.requestContext?.http?.method) return null;
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    const normalized = key.toLowerCase();
    if (Object.hasOwn(headers, normalized)) return null;
    headers[normalized] = value;
  }
  return {
    method: event.requestContext.http.method.toUpperCase(), path: event.rawPath,
    headers, body: event.body, isBase64Encoded: event.isBase64Encoded,
    verifiedJwtClaims: event.requestContext.authorizer?.jwt?.claims,
  };
}

export function invalidHttpApiEvent(): HttpResult {
  return {
    statusCode: 400,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: '{"error":"Invalid request"}',
  };
}

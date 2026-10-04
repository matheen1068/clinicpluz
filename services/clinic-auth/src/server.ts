import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClinicAuthApp } from './app.ts';
import { AuthStore } from './store.ts';

if (process.env.CLINIC_AUTH_LOCAL_ONLY !== '1' || process.env.NODE_ENV === 'production') {
  throw new Error('Local auth is disabled. This service must not be used as a production identity provider.');
}
process.umask(0o077);

const listenPort = Number(process.env.CLINIC_AUTH_PORT ?? 8787);
const publicPort = Number(process.env.CLINIC_PUBLIC_PORT ?? 5174);
if (![listenPort, publicPort].every((port) => Number.isInteger(port) && port >= 1 && port <= 65535)) {
  throw new Error('Invalid local port configuration');
}

const dbPath = resolve(process.env.CLINIC_AUTH_DB_PATH ?? 'data/local-auth.sqlite');
mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
const store = new AuthStore(dbPath);
const app = createClinicAuthApp(store, { publicPort });

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 8192) throw new Error('body too large');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const host = request.headers.host;
    if (!host || !request.url) {
      response.writeHead(400).end();
      return;
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    }
    const method = request.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(request);
    const webRequest = new Request(`http://${host}${request.url}`, { method, headers, body });
    const result = await app.handle(webRequest);
    for (const [key, value] of result.headers) {
      if (key !== 'set-cookie') response.setHeader(key, value);
    }
    const cookies = result.headers.getSetCookie();
    if (cookies.length) response.setHeader('Set-Cookie', cookies);
    response.writeHead(result.status);
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'body too large';
    response.writeHead(tooLarge ? 413 : 503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify({ error: tooLarge ? 'Request too large' : 'Clinic service unavailable' }));
  }
}

const server = createServer((request, response) => { void dispatch(request, response); });
server.listen(listenPort, '127.0.0.1', () => {
  console.log(`ClinicPluz local auth listening on 127.0.0.1:${listenPort}`);
});

function shutdown() {
  server.close(() => { store.close(); });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

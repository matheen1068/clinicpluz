const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'control', 'controlpanel', 'staging', 'www']);

export interface ClinicRouteContext {
  slug: string;
  mode: 'subdomain' | 'demo-path';
}

export function validClinicSlug(value: string): boolean {
  return value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) && !RESERVED_SLUGS.has(value);
}

function normalizeHost(value: string | undefined): string | null {
  if (!value) return null;
  const host = value.toLowerCase().replace(/\.$/, '');
  return /^[a-z0-9.-]+$/.test(host) ? host : null;
}

/** The URL selects a clinic context. It never grants access to that clinic. */
export function resolveClinicContext(
  hostname: string,
  pathname: string,
  baseDomain: string | undefined,
  demoHostname: string | undefined,
  isDev: boolean,
): ClinicRouteContext | null {
  const host = normalizeHost(hostname);
  if (!host) return null;

  const demo = normalizeHost(demoHostname);
  const approvedCloudFrontHost = demo && /^[a-z0-9-]+\.cloudfront\.net$/.test(demo) && host === demo;
  if (approvedCloudFrontHost || (isDev && host === 'localhost')) {
    const match = /^\/clinic\/([a-z0-9-]+)\/login\/?$/.exec(pathname);
    const slug = match?.[1];
    return slug && validClinicSlug(slug) ? { slug, mode: 'demo-path' } : null;
  }

  if (pathname !== '/login/' && pathname !== '/login') return null;

  if (isDev && host.endsWith('.localhost')) {
    const slug = host.slice(0, -'.localhost'.length);
    return validClinicSlug(slug) ? { slug, mode: 'subdomain' } : null;
  }

  const base = normalizeHost(baseDomain);
  if (!base || !host.endsWith(`.${base}`)) return null;
  const slug = host.slice(0, -(base.length + 1));
  return validClinicSlug(slug) ? { slug, mode: 'subdomain' } : null;
}

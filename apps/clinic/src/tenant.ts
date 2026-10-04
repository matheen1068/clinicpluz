const RESERVED_SLUGS = new Set(['admin', 'api', 'app', 'control', 'controlpanel', 'staging', 'www']);

function validSlug(value: string): boolean {
  return value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) && !RESERVED_SLUGS.has(value);
}

/** A hostname chooses a clinic context; it is never evidence of authorization. */
export function resolveClinicSlug(hostname: string, baseDomain: string | undefined, isDev: boolean): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const base = baseDomain?.toLowerCase().replace(/\.$/, '');

  if (isDev && host.endsWith('.localhost')) {
    const slug = host.slice(0, -'.localhost'.length);
    return validSlug(slug) ? slug : null;
  }

  if (!base || !host.endsWith(`.${base}`)) return null;
  const slug = host.slice(0, -(base.length + 1));
  return validSlug(slug) ? slug : null;
}

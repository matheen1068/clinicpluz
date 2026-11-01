import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

export type LogoContentType = 'image/png' | 'image/jpeg';
export interface ClinicProfile {
  slug: string;
  displayName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  revision: number;
  logo: { key: string; contentType: LogoContentType; sha256: string } | null;
}
export interface LogoUpload { bytes: Uint8Array; contentType: LogoContentType; sha256: string }

export function defaultProfile(slug: string, displayName: string): ClinicProfile {
  return { slug, displayName, address: null, phone: null, email: null, revision: 0, logo: null };
}
export function profileForClient(profile: ClinicProfile) {
  const { slug, displayName, address, phone, email, revision } = profile;
  return { slug, displayName, address, phone, email, revision,
    logo: profile.logo ? { url: `/api/workflow/clinics/${slug}/profile/logo`,
      contentType: profile.logo.contentType } : null };
}
export function clinicForPrint(profile: ClinicProfile) {
  return { slug: profile.slug, displayName: profile.displayName, address: profile.address,
    phone: profile.phone, email: profile.email,
    logoUrl: profile.logo ? `/api/workflow/clinics/${profile.slug}/profile/logo` : null };
}
function plainText(value: unknown, max: number, min = 1): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean.length >= min && clean.length <= max && !/[\u0000-\u001f\u007f<>]/.test(clean) ? clean : null;
}
export function profileFields(value: Record<string, unknown>):
  Pick<ClinicProfile, 'displayName' | 'address' | 'phone' | 'email'> | null {
  const displayName = plainText(value.displayName, 120, 2);
  const address = value.address === null ? null : plainText(value.address, 300);
  const phone = value.phone === null ? null : plainText(value.phone, 30);
  const email = value.email === null ? null : plainText(value.email, 254);
  if (!displayName || value.address !== null && !address || value.phone !== null && !phone ||
      value.email !== null && !email) return null;
  if (phone && (!/^\+?[0-9][0-9 ()-]{5,29}$/.test(phone) ||
      phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15)) return null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { displayName, address, phone, email: email?.toLowerCase() ?? null };
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]
      .includes(marker)) {
      if (length < 7) return null;
      return { height: bytes[offset + 3] * 256 + bytes[offset + 4],
        width: bytes[offset + 5] * 256 + bytes[offset + 6] };
    }
    offset += length;
  }
  return null;
}

export async function parseLogoUpload(contentType: unknown, dataBase64: unknown): Promise<LogoUpload | null> {
  if (contentType !== 'image/png' && contentType !== 'image/jpeg' ||
      typeof dataBase64 !== 'string' || dataBase64.length < 32 || dataBase64.length > 4_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) return null;
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length < 32 || bytes.length > 3_000_000 || bytes.toString('base64') !== dataBase64) return null;
  let dimensions: { width: number; height: number } | null = null;
  if (contentType === 'image/png') {
    const signature = Buffer.from('89504e470d0a1a0a', 'hex');
    if (!Buffer.from(bytes.subarray(0, 8)).equals(signature) || bytes.readUInt32BE(8) !== 13 ||
        bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
    dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else dimensions = jpegDimensions(bytes);
  if (!dimensions || dimensions.width < 1 || dimensions.width > 2048 ||
      dimensions.height < 1 || dimensions.height > 2048) return null;
  try {
    // Validate decoding before storing; the header dimension cap limits decompression work.
    const pdf = await PDFDocument.create();
    const embedded = contentType === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    if (embedded.width !== dimensions.width || embedded.height !== dimensions.height) return null;
  } catch { return null; }
  return { bytes, contentType, sha256: createHash('sha256').update(bytes).digest('hex') };
}

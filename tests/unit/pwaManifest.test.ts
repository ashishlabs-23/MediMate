import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface PngInspection {
  byteLength: number;
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  isFullyOpaque: boolean;
  distinctColorCount: number;
  hasExactBrandTeal: boolean;
  hasExactWhiteEmblem: boolean;
  pixels: Uint8Array;
  bytesPerPixel: number;
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  orientation: string;
  icons: ManifestIcon[];
  categories: string[];
  lang: string;
  dir: string;
  prefer_related_applications: boolean;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterScanlines(
  inflated: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number
): Uint8Array {
  const stride = width * bytesPerPixel;
  const expectedLength = height * (1 + stride);
  if (inflated.byteLength !== expectedLength) {
    throw new Error(
      `Unexpected inflated PNG buffer length: got ${inflated.byteLength}, expected ${expectedLength}`
    );
  }

  const pixels = new Uint8Array(height * stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride);
    const filterType = inflated[rowStart];
    const outRowStart = y * stride;
    const prevRowStart = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const raw = inflated[rowStart + 1 + x] ?? 0;
      const left = x >= bytesPerPixel ? (pixels[outRowStart + x - bytesPerPixel] ?? 0) : 0;
      const up = y > 0 ? (pixels[prevRowStart + x] ?? 0) : 0;
      const upLeft =
        y > 0 && x >= bytesPerPixel ? (pixels[prevRowStart + x - bytesPerPixel] ?? 0) : 0;

      let recon: number;
      switch (filterType) {
        case 0:
          recon = raw;
          break;
        case 1:
          recon = (raw + left) & 0xff;
          break;
        case 2:
          recon = (raw + up) & 0xff;
          break;
        case 3:
          recon = (raw + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          recon = (raw + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`Unsupported PNG scanline filter type: ${String(filterType)}`);
      }
      pixels[outRowStart + x] = recon;
    }
  }

  return pixels;
}

function inspectPng(filePath: string): PngInspection {
  const buf = fs.readFileSync(filePath);
  if (buf.byteLength <= 1024) {
    throw new Error(`PNG at ${filePath} is too small (${buf.byteLength} bytes)`);
  }
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`Invalid PNG signature at ${filePath}`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let seenIhdr = false;
  let seenIend = false;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= buf.byteLength) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.byteLength) {
      throw new Error(`Truncated PNG chunk ${type} in ${filePath}`);
    }
    const data = buf.subarray(dataStart, dataEnd);

    if (!seenIhdr) {
      if (type !== 'IHDR' || length !== 13) {
        throw new Error(`First PNG chunk must be 13-byte IHDR in ${filePath}`);
      }
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      seenIhdr = true;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      seenIend = true;
      break;
    }

    offset = dataEnd + 4;
  }

  if (!seenIhdr || !seenIend || idatChunks.length === 0) {
    throw new Error(`Incomplete PNG structure in ${filePath}`);
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(
      `Expected 8-bit RGB(2) or RGBA(6) PNG in ${filePath}, got bitDepth=${bitDepth}, colorType=${colorType}`
    );
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixels = unfilterScanlines(inflated, width, height, bytesPerPixel);

  const distinctColors = new Set<number>();
  let isFullyOpaque = true;
  let hasExactBrandTeal = false;
  let hasExactWhiteEmblem = false;

  for (let i = 0; i < pixels.length; i += bytesPerPixel) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    const a = bytesPerPixel === 4 ? (pixels[i + 3] ?? 255) : 255;

    if (a < 255) {
      isFullyOpaque = false;
    }
    if (distinctColors.size < 256) {
      distinctColors.add((r << 16) | (g << 8) | b);
    }
    if (r === 17 && g === 94 && b === 89 && a === 255) {
      hasExactBrandTeal = true;
    }
    if (r === 255 && g === 255 && b === 255 && a === 255) {
      hasExactWhiteEmblem = true;
    }
  }

  return {
    byteLength: buf.byteLength,
    width,
    height,
    bitDepth,
    colorType,
    isFullyOpaque,
    distinctColorCount: distinctColors.size,
    hasExactBrandTeal,
    hasExactWhiteEmblem,
    pixels,
    bytesPerPixel,
  };
}

function getPixel(
  info: PngInspection,
  x: number,
  y: number
): [number, number, number, number] {
  const idx = (y * info.width + x) * info.bytesPerPixel;
  const r = info.pixels[idx] ?? 0;
  const g = info.pixels[idx + 1] ?? 0;
  const b = info.pixels[idx + 2] ?? 0;
  const a = info.bytesPerPixel === 4 ? (info.pixels[idx + 3] ?? 255) : 255;
  return [r, g, b, a];
}

describe('PWA Branded Icons, Manifest, and HTML Metadata', () => {
  it('provides valid, high-resolution branded PNG icons matching declared dimensions', () => {
    const icon192 = inspectPng(path.join(PUBLIC_DIR, 'icons/icon-192.png'));
    expect(icon192.width).toBe(192);
    expect(icon192.height).toBe(192);
    expect(icon192.colorType).toBe(6);
    expect(icon192.byteLength).toBeGreaterThan(1024);
    expect(icon192.distinctColorCount).toBeGreaterThan(2);
    expect(icon192.hasExactBrandTeal).toBe(true);
    expect(icon192.hasExactWhiteEmblem).toBe(true);
    expect(getPixel(icon192, 0, 0)[3]).toBe(0);
    expect(getPixel(icon192, 96, 96)).toEqual([255, 255, 255, 255]);

    const icon512 = inspectPng(path.join(PUBLIC_DIR, 'icons/icon-512.png'));
    expect(icon512.width).toBe(512);
    expect(icon512.height).toBe(512);
    expect(icon512.colorType).toBe(6);
    expect(icon512.byteLength).toBeGreaterThan(1024);
    expect(icon512.distinctColorCount).toBeGreaterThan(2);
    expect(icon512.hasExactBrandTeal).toBe(true);
    expect(icon512.hasExactWhiteEmblem).toBe(true);
    expect(getPixel(icon512, 0, 0)[3]).toBe(0);
    expect(getPixel(icon512, 256, 256)).toEqual([255, 255, 255, 255]);

    const appleTouch = inspectPng(path.join(PUBLIC_DIR, 'icons/apple-touch-icon.png'));
    expect(appleTouch.width).toBe(180);
    expect(appleTouch.height).toBe(180);
    expect(appleTouch.colorType).toBe(2);
    expect(appleTouch.isFullyOpaque).toBe(true);
    expect(appleTouch.byteLength).toBeGreaterThan(1024);
    expect(appleTouch.distinctColorCount).toBeGreaterThan(2);
    expect(appleTouch.hasExactBrandTeal).toBe(true);
    expect(appleTouch.hasExactWhiteEmblem).toBe(true);
    expect(getPixel(appleTouch, 0, 0)).toEqual([17, 94, 89, 255]);
    expect(getPixel(appleTouch, 90, 90)).toEqual([255, 255, 255, 255]);

    const maskable512 = inspectPng(path.join(PUBLIC_DIR, 'icons/icon-maskable-512.png'));
    expect(maskable512.width).toBe(512);
    expect(maskable512.height).toBe(512);
    expect(maskable512.colorType).toBe(2);
    expect(maskable512.isFullyOpaque).toBe(true);
    expect(maskable512.byteLength).toBeGreaterThan(1024);
    expect(maskable512.distinctColorCount).toBeGreaterThan(2);
    expect(maskable512.hasExactBrandTeal).toBe(true);
    expect(maskable512.hasExactWhiteEmblem).toBe(true);
    expect(getPixel(maskable512, 256, 256)).toEqual([255, 255, 255, 255]);

    // Verify all pixels outside the W3C 80% safe-zone circle (radius 204.8px) are pure brand teal
    const center = 255.5;
    const safeRadiusSq = 204.8 * 204.8;
    for (let y = 0; y < maskable512.height; y += 4) {
      for (let x = 0; x < maskable512.width; x += 4) {
        const dx = x - center;
        const dy = y - center;
        if (dx * dx + dy * dy > safeRadiusSq) {
          expect(getPixel(maskable512, x, y)).toEqual([17, 94, 89, 255]);
        }
      }
    }
  });

  it('configures public/manifest.json with valid metadata, scope, and separated icon purposes', () => {
    const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as WebManifest;

    expect(manifest.id).toBe('/app/today');
    expect(manifest.name).toContain('MediMate');
    expect(manifest.short_name).toBe('MediMate');
    expect(manifest.description.length).toBeGreaterThan(10);
    expect(manifest.start_url).toBe('/app/today');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBe('#F8FAFC');
    expect(manifest.theme_color).toBe('#115E59');
    expect(manifest.orientation).toBe('portrait-primary');
    expect(manifest.categories).toEqual(['health', 'medical']);
    expect(manifest.lang).toBe('en-IN');
    expect(manifest.dir).toBe('ltr');
    expect(manifest.prefer_related_applications).toBe(false);

    expect(manifest.icons.length).toBe(3);

    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
      expect(['any', 'maskable']).toContain(icon.purpose);
      expect(icon.purpose).not.toBe('any maskable');

      const relPath = icon.src.replace(/^\//, '');
      const fullPath = path.join(PUBLIC_DIR, relPath);
      expect(fs.existsSync(fullPath)).toBe(true);

      const inspected = inspectPng(fullPath);
      expect(icon.sizes).toBe(`${inspected.width}x${inspected.height}`);
    }

    expect(manifest.icons).toContainEqual({
      src: '/icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any',
    });
    expect(manifest.icons).toContainEqual({
      src: '/icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any',
    });
    expect(manifest.icons).toContainEqual({
      src: '/icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    });
  });

  it('references branded icons, apple-touch-icon, manifest, and theme-color in index.html', () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'index.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const themeColor = doc.querySelector('meta[name="theme-color"]');
    expect(themeColor?.getAttribute('content')).toBe('#115E59');

    expect(doc.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content')).toBe('yes');
    expect(
      doc.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content')
    ).toBe('default');
    expect(doc.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content')).toBe(
      'MediMate'
    );

    const manifestLink = doc.querySelector('link[rel="manifest"]');
    expect(manifestLink?.getAttribute('href')).toBe('/manifest.json');

    const icon192 = doc.querySelector('link[rel="icon"][sizes="192x192"]');
    expect(icon192?.getAttribute('type')).toBe('image/png');
    expect(icon192?.getAttribute('href')).toBe('/icons/icon-192.png');

    const icon512 = doc.querySelector('link[rel="icon"][sizes="512x512"]');
    expect(icon512?.getAttribute('type')).toBe('image/png');
    expect(icon512?.getAttribute('href')).toBe('/icons/icon-512.png');

    const appleIcon = doc.querySelector('link[rel="apple-touch-icon"]');
    expect(appleIcon?.getAttribute('sizes')).toBe('180x180');
    expect(appleIcon?.getAttribute('href')).toBe('/icons/apple-touch-icon.png');
    expect(fs.existsSync(path.join(PUBLIC_DIR, 'icons/apple-touch-icon.png'))).toBe(true);

    // Ensure pre-loader and module entrypoint remain intact
    expect(doc.querySelector('#root')).not.toBeNull();
    expect(doc.querySelector('noscript')).not.toBeNull();
    expect(doc.querySelector('script[type="module"][src="/src/main.tsx"]')).not.toBeNull();
  });
});

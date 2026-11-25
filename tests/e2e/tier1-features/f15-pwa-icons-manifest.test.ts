import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

interface PngMetadata {
  byteLength: number;
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  hasIdat: boolean;
  hasIend: boolean;
  idatTotalBytes: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parsePng(filePath: string): PngMetadata {
  const buf = fs.readFileSync(filePath);
  expect(buf.length, `${filePath} must be larger than 24 bytes`).toBeGreaterThan(24);
  expect(buf.subarray(0, 8).equals(PNG_SIGNATURE), `${filePath} missing valid PNG signature`).toBe(
    true
  );

  const ihdrLen = buf.readUInt32BE(8);
  const ihdrType = buf.subarray(12, 16).toString('ascii');
  expect(ihdrType, `${filePath} first chunk must be IHDR`).toBe('IHDR');
  expect(ihdrLen, `${filePath} IHDR length must be 13`).toBe(13);

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf.readUInt8(24);
  const colorType = buf.readUInt8(25);

  let offset = 8;
  let hasIdat = false;
  let hasIend = false;
  let idatTotalBytes = 0;

  while (offset + 8 <= buf.length) {
    const chunkLen = buf.readUInt32BE(offset);
    const chunkType = buf.subarray(offset + 4, offset + 8).toString('ascii');
    if (chunkType === 'IDAT') {
      hasIdat = true;
      idatTotalBytes += chunkLen;
    } else if (chunkType === 'IEND') {
      hasIend = true;
      break;
    }
    offset += 12 + chunkLen;
  }

  return {
    byteLength: buf.length,
    width,
    height,
    bitDepth,
    colorType,
    hasIdat,
    hasIend,
    idatTotalBytes,
  };
}

function resolvePublicAsset(webPath: string): string {
  const clean = webPath.replace(/^\/+/, '');
  return path.resolve(PROJECT_ROOT, 'public', clean);
}

function extractLinkHref(html: string, relValue: string): string | null {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const relMatch = tag.match(/\brel\s*=\s*["']([^"']+)["']/i);
    if (relMatch && relMatch[1].toLowerCase() === relValue.toLowerCase()) {
      const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
      return hrefMatch ? hrefMatch[1] : null;
    }
  }
  return null;
}

function extractMetaContent(html: string, nameValue: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    const nameMatch = tag.match(/\bname\s*=\s*["']([^"']+)["']/i);
    if (nameMatch && nameMatch[1].toLowerCase() === nameValue.toLowerCase()) {
      const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
      return contentMatch ? contentMatch[1] : null;
    }
  }
  return null;
}

describe('Tier 1 — F15: Branded PWA Icons & Manifest/HTML Metadata (Phase 4A / R1)', () => {
  it('T1-F15-01: public/icons/icon-192.png exists as a valid non-placeholder 192x192 PNG', () => {
    const icon192Path = resolvePublicAsset('/icons/icon-192.png');
    expect(fs.existsSync(icon192Path)).toBe(true);

    const png = parsePng(icon192Path);
    expect(png.width).toBe(192);
    expect(png.height).toBe(192);
    expect(png.hasIdat).toBe(true);
    expect(png.hasIend).toBe(true);
    expect(png.byteLength).toBeGreaterThan(500);
    expect(png.idatTotalBytes).toBeGreaterThan(200);
  });

  it('T1-F15-02: public/icons/icon-512.png exists as a valid non-placeholder 512x512 PNG', () => {
    const icon512Path = resolvePublicAsset('/icons/icon-512.png');
    expect(fs.existsSync(icon512Path)).toBe(true);

    const png = parsePng(icon512Path);
    expect(png.width).toBe(512);
    expect(png.height).toBe(512);
    expect(png.hasIdat).toBe(true);
    expect(png.hasIend).toBe(true);
    expect(png.byteLength).toBeGreaterThan(1000);
    expect(png.idatTotalBytes).toBeGreaterThan(500);
  });

  it('T1-F15-03: apple-touch-icon asset exists as a dedicated valid 180x180 PNG', () => {
    const html = fs.readFileSync(path.resolve(PROJECT_ROOT, 'index.html'), 'utf-8');
    const appleHref = extractLinkHref(html, 'apple-touch-icon');
    expect(appleHref).toBeTruthy();
    expect(appleHref).not.toBe('/icons/icon-192.png');

    const appleIconPath = resolvePublicAsset(appleHref!);
    expect(fs.existsSync(appleIconPath)).toBe(true);

    const png = parsePng(appleIconPath);
    expect(png.width).toBe(180);
    expect(png.height).toBe(180);
    expect(png.hasIdat).toBe(true);
    expect(png.hasIend).toBe(true);
    expect(png.byteLength).toBeGreaterThan(500);
  });

  it('T1-F15-04: public/manifest.json has valid MediMate metadata and resolves 192x192 & 512x512 icons', () => {
    const manifestPath = path.resolve(PROJECT_ROOT, 'public/manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      display?: string;
      theme_color?: string;
      background_color?: string;
      icons?: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
    };

    expect(manifest.name).toMatch(/MediMate/i);
    expect(manifest.short_name).toBe('MediMate');
    expect(manifest.start_url).toBe('/app/today');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color?.toUpperCase()).toBe('#115E59');
    expect(manifest.background_color?.toUpperCase()).toBe('#F8FAFC');

    const icons = manifest.icons ?? [];
    const icon192 = icons.find((i) => i.sizes.includes('192x192'));
    const icon512 = icons.find((i) => i.sizes.includes('512x512'));
    expect(icon192).toBeDefined();
    expect(icon512).toBeDefined();

    for (const entry of [icon192!, icon512!]) {
      expect(entry.type).toBe('image/png');
      const diskPath = resolvePublicAsset(entry.src);
      expect(fs.existsSync(diskPath), `Missing manifest icon ${entry.src}`).toBe(true);
      const parsed = parsePng(diskPath);
      const [expectedW, expectedH] = entry.sizes.split('x').map(Number);
      expect(parsed.width).toBe(expectedW);
      expect(parsed.height).toBe(expectedH);
    }
  });

  it('T1-F15-05: index.html links manifest, theme-color, favicon, and apple-touch-icon consistently', () => {
    const html = fs.readFileSync(path.resolve(PROJECT_ROOT, 'index.html'), 'utf-8');
    const manifestHref = extractLinkHref(html, 'manifest');
    const iconHref = extractLinkHref(html, 'icon');
    const appleHref = extractLinkHref(html, 'apple-touch-icon');
    const themeColor = extractMetaContent(html, 'theme-color');

    expect(manifestHref).toBe('/manifest.json');
    expect(themeColor?.toUpperCase()).toBe('#115E59');
    expect(iconHref).toBeTruthy();
    expect(appleHref).toBeTruthy();

    expect(fs.existsSync(resolvePublicAsset(iconHref!))).toBe(true);
    expect(fs.existsSync(resolvePublicAsset(appleHref!))).toBe(true);
  });

  it('T1-F15-06: Branded PNG icons use standard RGB/RGBA bit depths and non-uniform artwork payload', () => {
    const paths = [
      resolvePublicAsset('/icons/icon-192.png'),
      resolvePublicAsset('/icons/icon-512.png'),
      resolvePublicAsset('/icons/apple-touch-icon.png'),
    ];

    for (const p of paths) {
      expect(fs.existsSync(p), `Expected icon at ${p}`).toBe(true);
      const png = parsePng(p);
      expect([2, 3, 6]).toContain(png.colorType);
      expect([8, 16]).toContain(png.bitDepth);
      // Distinct rendered icon content has substantially more payload than a blank uniform canvas
      expect(png.idatTotalBytes).toBeGreaterThan(300);
    }
  });
});

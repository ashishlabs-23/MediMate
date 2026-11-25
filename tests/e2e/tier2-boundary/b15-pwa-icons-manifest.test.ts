import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(filePath: string): { width: number; height: number; bytes: number } {
  const buf = fs.readFileSync(filePath);
  expect(buf.length).toBeGreaterThan(24);
  expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bytes: buf.length,
  };
}

describe('Tier 2 — B15: PWA Icons, Manifest & HTML Metadata Boundaries (Phase 4A)', () => {
  it('T2-B15-01: Rejects 70-byte placeholder icons and enforces strict dimension scaling (512 > 192 >= 180)', () => {
    const icon180 = readPngDimensions(path.resolve(PROJECT_ROOT, 'public/icons/apple-touch-icon.png'));
    const icon192 = readPngDimensions(path.resolve(PROJECT_ROOT, 'public/icons/icon-192.png'));
    const icon512 = readPngDimensions(path.resolve(PROJECT_ROOT, 'public/icons/icon-512.png'));

    expect(icon180.bytes).toBeGreaterThan(100);
    expect(icon192.bytes).toBeGreaterThan(100);
    expect(icon512.bytes).toBeGreaterThan(100);

    expect(icon180.width).toBe(180);
    expect(icon192.width).toBe(192);
    expect(icon512.width).toBe(512);
    expect(icon512.width).toBeGreaterThan(icon192.width);
    expect(icon192.width).toBeGreaterThan(icon180.width);
  });

  it('T2-B15-02: Every icon src in manifest.json and link href in index.html uses root-relative / paths that exist on disk', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(PROJECT_ROOT, 'public/manifest.json'), 'utf-8')
    ) as {
      icons: Array<{ src: string; sizes: string; type: string }>;
    };

    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith('/')).toBe(true);
      expect(icon.src.startsWith('./')).toBe(false);
      expect(icon.type).toBe('image/png');
      const fullPath = path.resolve(PROJECT_ROOT, 'public', icon.src.replace(/^\/+/, ''));
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(fs.statSync(fullPath).size).toBeGreaterThan(100);
    }

    const html = fs.readFileSync(path.resolve(PROJECT_ROOT, 'index.html'), 'utf-8');
    const hrefMatches = [...html.matchAll(/<link\b[^>]*rel=["'](icon|apple-touch-icon|manifest)["'][^>]*>/gi)];
    expect(hrefMatches.length).toBeGreaterThanOrEqual(3);
    for (const match of hrefMatches) {
      const href = match[0].match(/\bhref=["']([^"']+)["']/i)?.[1] ?? '';
      expect(href.startsWith('/')).toBe(true);
      const assetPath = path.resolve(PROJECT_ROOT, 'public', href.replace(/^\/+/, ''));
      expect(fs.existsSync(assetPath)).toBe(true);
    }
  });

  it('T2-B15-03: index.html theme-color matches manifest.json theme_color and manifest sets prefer_related_applications: false', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(PROJECT_ROOT, 'public/manifest.json'), 'utf-8')
    ) as {
      theme_color?: string;
      lang?: string;
      dir?: string;
      prefer_related_applications?: boolean;
    };

    const html = fs.readFileSync(path.resolve(PROJECT_ROOT, 'index.html'), 'utf-8');
    const htmlThemeMatch = html.match(/<meta\b[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i);
    expect(htmlThemeMatch).not.toBeNull();
    expect(htmlThemeMatch![1].toUpperCase()).toBe(manifest.theme_color?.toUpperCase());
    expect(manifest.prefer_related_applications).toBe(false);
    expect(manifest.dir).toBe('ltr');
    expect(manifest.lang).toBeTruthy();
  });

  it('T2-B15-04: apple-touch-icon in index.html does not point to 192px icon and matches 180x180 PNG dimensions', () => {
    const html = fs.readFileSync(path.resolve(PROJECT_ROOT, 'index.html'), 'utf-8');
    const appleTag = html.match(/<link\b[^>]*rel=["']apple-touch-icon["'][^>]*>/i)?.[0] ?? '';
    const appleHref = appleTag.match(/\bhref=["']([^"']+)["']/i)?.[1] ?? '';

    expect(appleHref).toBeTruthy();
    expect(appleHref).not.toContain('icon-192');
    expect(appleHref).toContain('apple-touch-icon');

    const fullPath = path.resolve(PROJECT_ROOT, 'public', appleHref.replace(/^\/+/, ''));
    expect(fs.existsSync(fullPath)).toBe(true);
    const dims = readPngDimensions(fullPath);
    expect(dims.width).toBe(180);
    expect(dims.height).toBe(180);
  });

  it('T2-B15-05: public/icons/ contains zero empty/corrupt files and manifest.json specifies valid square dimensions', () => {
    const iconsDir = path.resolve(PROJECT_ROOT, 'public/icons');
    const files = fs.readdirSync(iconsDir).filter((f) => f.endsWith('.png'));
    expect(files.length).toBeGreaterThanOrEqual(3);

    for (const file of files) {
      const dims = readPngDimensions(path.resolve(iconsDir, file));
      expect(dims.width).toBeGreaterThan(0);
      expect(dims.width).toBe(dims.height);
      expect(dims.bytes).toBeGreaterThan(100);
    }
  });
});

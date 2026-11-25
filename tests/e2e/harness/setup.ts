import { afterEach, vi } from 'vitest';

/**
 * Lightweight DOM shim used only when Vitest executes in Node fallback mode
 * (e.g. before M2 installs `jsdom` in local node_modules).
 * When real `jsdom` is active, this block is skipped completely.
 */
if (typeof globalThis.document === 'undefined') {
  class MiniClassList {
    private classes: Set<string>;
    constructor(initial = '') {
      this.classes = new Set(initial.split(/\s+/).filter(Boolean));
    }
    add(...tokens: string[]): void {
      tokens.forEach((t) => this.classes.add(t));
    }
    remove(...tokens: string[]): void {
      tokens.forEach((t) => this.classes.delete(t));
    }
    contains(token: string): boolean {
      return this.classes.has(token);
    }
    toString(): string {
      return Array.from(this.classes).join(' ');
    }
  }

  class MiniEvent {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  }

  class MiniElement {
    tagName: string;
    attributes = new Map<string, string>();
    style: Record<string, string> = {};
    children: MiniElement[] = [];
    parentElement: MiniElement | null = null;
    classList: MiniClassList;
    private _textContent = '';
    private listeners = new Map<string, Array<(event: MiniEvent) => void>>();

    constructor(tagName: string) {
      this.tagName = tagName.toUpperCase();
      this.classList = new MiniClassList();
    }

    get id(): string {
      return this.attributes.get('id') ?? '';
    }
    set id(val: string) {
      this.attributes.set('id', val);
    }

    get className(): string {
      return this.classList.toString();
    }
    set className(val: string) {
      this.classList = new MiniClassList(val);
    }

    get disabled(): boolean {
      return this.attributes.has('disabled');
    }
    set disabled(val: boolean) {
      if (val) {
        this.attributes.set('disabled', 'true');
      } else {
        this.attributes.delete('disabled');
      }
    }

    get textContent(): string {
      if (this.children.length === 0) {
        return this._textContent;
      }
      const childText = this.children.map((c) => c.textContent).join(' ');
      return [this._textContent, childText].filter(Boolean).join(' ').trim();
    }
    set textContent(val: string) {
      this._textContent = val;
      this.children = [];
    }

    get innerHTML(): string {
      if (this.children.length === 0) {
        return this._textContent;
      }
      return this.children
        .map((c) => `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`)
        .join('');
    }
    set innerHTML(val: string) {
      this._textContent = val;
      this.children = [];
    }

    setAttribute(name: string, value: string): void {
      if (name === 'class') {
        this.className = value;
      } else {
        this.attributes.set(name, String(value));
      }
    }

    getAttribute(name: string): string | null {
      if (name === 'class') return this.className;
      return this.attributes.get(name) ?? null;
    }

    hasAttribute(name: string): boolean {
      return this.attributes.has(name);
    }

    removeAttribute(name: string): void {
      this.attributes.delete(name);
    }

    appendChild(child: MiniElement): MiniElement {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    removeChild(child: MiniElement): MiniElement {
      this.children = this.children.filter((c) => c !== child);
      child.parentElement = null;
      return child;
    }

    addEventListener(type: string, fn: (event: MiniEvent) => void): void {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }

    removeEventListener(type: string, fn: (event: MiniEvent) => void): void {
      const list = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        list.filter((l) => l !== fn)
      );
    }

    dispatchEvent(event: MiniEvent): boolean {
      const list = this.listeners.get(event.type) ?? [];
      list.forEach((fn) => fn(event));
      return true;
    }

    click(): void {
      if (this.disabled || this.getAttribute('aria-disabled') === 'true') {
        return;
      }
      this.dispatchEvent(new MiniEvent('click'));
    }

    getBoundingClientRect(): { width: number; height: number; top: number; left: number; bottom: number; right: number } {
      const parseSize = (raw: string | undefined): number => {
        if (!raw) return 0;
        const match = /^(-?\d+(?:\.\d+)?)px$/i.exec(raw.trim());
        if (!match) return 0;
        const n = parseFloat(match[1]);
        return Number.isNaN(n) ? 0 : n;
      };
      const width = parseSize(this.style.width) || parseSize(this.style.minWidth);
      const height = parseSize(this.style.height) || parseSize(this.style.minHeight);
      return { width, height, top: 0, left: 0, bottom: height, right: width };
    }

    private matchesSelector(selector: string): boolean {
      const trimmed = selector.trim();
      if (trimmed.startsWith('#')) {
        return this.id === trimmed.slice(1);
      }
      if (trimmed.startsWith('.')) {
        return this.classList.contains(trimmed.slice(1));
      }
      const attrMatch = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(trimmed);
      if (attrMatch) {
        const [, attrName, attrVal] = attrMatch;
        if (attrVal === undefined) return this.hasAttribute(attrName);
        return this.getAttribute(attrName) === attrVal;
      }
      return this.tagName.toLowerCase() === trimmed.toLowerCase();
    }

    querySelectorAll(selector: string): MiniElement[] {
      const selectors = selector.split(',').map((s) => s.trim());
      const results: MiniElement[] = [];
      const walk = (node: MiniElement) => {
        for (const child of node.children) {
          if (selectors.some((sel) => child.matchesSelector(sel))) {
            results.push(child);
          }
          walk(child);
        }
      };
      walk(this);
      return results;
    }

    querySelector(selector: string): MiniElement | null {
      return this.querySelectorAll(selector)[0] ?? null;
    }
  }

  const body = new MiniElement('body');
  const windowListeners = new Map<string, Array<(event: MiniEvent) => void>>();

  const miniWindow = {
    navigator: {
      onLine: true,
      vibrate: vi.fn(() => true),
    },
    getComputedStyle: (el: MiniElement) => ({
      width: el.style.width ?? '',
      height: el.style.height ?? '',
      minWidth: el.style.minWidth ?? '',
      minHeight: el.style.minHeight ?? '',
      color: el.style.color ?? '',
      backgroundColor: el.style.backgroundColor ?? '',
      marginTop: el.style.marginTop ?? '0px',
      marginBottom: el.style.marginBottom ?? '0px',
      marginLeft: el.style.marginLeft ?? '0px',
      marginRight: el.style.marginRight ?? '0px',
    }),
    addEventListener: (type: string, fn: (event: MiniEvent) => void) => {
      const list = windowListeners.get(type) ?? [];
      list.push(fn);
      windowListeners.set(type, list);
    },
    removeEventListener: (type: string, fn: (event: MiniEvent) => void) => {
      const list = windowListeners.get(type) ?? [];
      windowListeners.set(
        type,
        list.filter((l) => l !== fn)
      );
    },
    dispatchEvent: (event: MiniEvent) => {
      const list = windowListeners.get(event.type) ?? [];
      list.forEach((fn) => fn(event));
      return true;
    },
  };

  const miniDocument = {
    body,
    createElement: (tag: string) => new MiniElement(tag),
    querySelector: (sel: string) => body.querySelector(sel),
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
    getElementById: (id: string) => body.querySelector(`#${id}`),
  };

  (globalThis as Record<string, unknown>).Event = MiniEvent;
  (globalThis as Record<string, unknown>).HTMLElement = MiniElement;
  (globalThis as Record<string, unknown>).document = miniDocument;
  (globalThis as Record<string, unknown>).window = miniWindow;
  if (typeof globalThis.navigator === 'undefined') {
    (globalThis as Record<string, unknown>).navigator = miniWindow.navigator;
  }
}

if (typeof navigator !== 'undefined' && typeof navigator.vibrate !== 'function') {
  Object.defineProperty(navigator, 'vibrate', {
    value: vi.fn(() => true),
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  vi.useRealTimers();
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML = '';
  }
});

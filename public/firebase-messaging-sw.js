/**
 * firebase-messaging-sw.js — FCM Service Worker for background push notifications & offline asset caching.
 *
 * This file must be served from the root path (/firebase-messaging-sw.js).
 * It handles:
 *   1. Offline PWA launch: Cache-first static asset caching (HTML shell, /icons/*, /manifest.json, bundled assets)
 *   2. Background FCM push messages when the app is not in the foreground.
 *
 * Uses Firebase compat SDK (not modular) for service worker compatibility.
 */

/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// ── Cache Configuration ──────────────────────────────────────────────────────
const CACHE_NAME = 'medimate-static-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.warn('[firebase-messaging-sw.js] Precache failed during install:', err);
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Fetch interceptor:
 * - Cache-first for same-origin static assets and bundled JS/CSS
 * - Network-with-cache-fallback for navigation requests so PWA launches offline
 * - Cross-origin requests (e.g. Firebase, Firestore, Google APIs) pass through untouched
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navigation requests (HTML document loads)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedShell = await caches.match('/index.html');
          if (cachedShell) return cachedShell;
          return caches.match('/');
        })
    );
    return;
  }

  // Static assets (bundled JS/CSS, images, icons, manifest)
  const isStaticAsset =
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/favicon.ico' ||
    /\.(?:js|css|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        });
      })
    );
  }
});

// ── Firebase Configuration ────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: 'AIzaSyCMcRRpvdvnfNyebPEBjHH6EyKaCK_7boc',
  authDomain: 'medimate-e27da.firebaseapp.com',
  projectId: 'medimate-e27da',
  storageBucket: 'medimate-e27da.firebasestorage.app',
  messagingSenderId: '84707647710',
  appId: '1:84707647710:web:e6e8a1e64ef59b9b87a24f',
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

/**
 * Handle background push messages.
 * Shows a system notification when the app is not in the foreground.
 */
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Background message received:', payload);

  const notificationTitle = payload.notification?.title ?? 'MediMate Reminder';
  const notificationOptions = {
    body: payload.notification?.body ?? 'Please check your medications.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.data?.type ?? 'medimate-reminder',
    data: payload.data,
    requireInteraction: payload.data?.type === 'escalation',
    vibrate: [200, 100, 200],
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

/**
 * Handle notification click — open/focus the app.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = new URL('/app/today', self.location.origin).href;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

/**
 * firebase-messaging-sw.js — FCM Service Worker for background push notifications.
 *
 * This file must be served from the root path (/firebase-messaging-sw.js).
 * It handles background FCM messages when the app is not in the foreground.
 *
 * IMPORTANT: Keep this file in sync with the Firebase SDK version used in the app.
 * Uses Firebase compat SDK (not modular) for service worker compatibility.
 */

/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Firebase config must match src/lib/firebase.ts.
// These values are safe to include in a service worker (not secret).
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

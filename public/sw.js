// sw.js — minimal service worker, required for "Add to Home Screen" to be offered
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
self.addEventListener('fetch', () => {}); // no offline caching yet, just needs to exist

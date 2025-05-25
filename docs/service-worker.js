const CACHE_NAME = 'auto-cache-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
      try {
        const networkResponse = await fetch(request);

        const { status, statusText, type } = networkResponse;

        if (!status || status > 399) {
          return networkResponse;
        }
        const newHeaders = new Headers(networkResponse.headers);
        newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
        newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
        newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');

        const responseWithModifiedHeaders = new Response(networkResponse.body, {
          status: status,
          statusText: statusText,
          headers: newHeaders,
        });

        if (status === 200 && type === 'basic') {
          cache.put(request, responseWithModifiedHeaders.clone());
        }

        return responseWithModifiedHeaders;
      } catch (error) {
        return new Response('Offline and not cached', {
          status: 503,
          statusText: 'Service Unavailable',
        });
      }
    }),
  );
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { title: 'JanRaksha alert', body: event.data ? event.data.text() : 'Open JanRaksha to view the update.' }; }

  event.waitUntil(self.registration.showNotification(payload.title || 'JanRaksha alert', {
    body: payload.body || 'Open JanRaksha to view the update.',
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { url: payload.url || '/?page=emergency' },
    tag: 'janraksha-emergency'
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const requested = new URL(event.notification.data?.url || '/?page=emergency', self.location.origin);
  const target = requested.origin === self.location.origin ? requested.href : self.location.origin + '/?page=emergency';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && 'focus' in client) {
        return client.navigate(target).then(() => client.focus());
      }
    }
    return self.clients.openWindow(target);
  }));
});

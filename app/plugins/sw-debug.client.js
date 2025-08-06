export default defineNuxtPlugin(() => {
  if ('serviceWorker' in navigator) {
    console.log('[SW-Debug] Service Worker API available');
    
    navigator.serviceWorker.getRegistration().then(registration => {
        if (registration) {
          console.log('[SW-Debug] Service Worker registered:', registration);
          console.log('[SW-Debug] Active:', !!registration.active);
          console.log('[SW-Debug] Installing:', !!registration.installing);
          console.log('[SW-Debug] Waiting:', !!registration.waiting);
          if (registration.active) {
            console.log('[SW-Debug] Testing communication with SW...');
            registration.active.postMessage({
              type: 'PING',
              timestamp: Date.now()
            });
          }
        } else {
          console.log('[SW-Debug] No Service Worker registration found. Registering /sw.js...');
          navigator.serviceWorker.register('/sw.js').then(newRegistration => {
            console.log('[SW-Debug] Service Worker registered:', newRegistration);
          }).catch(error => {
            console.error('[SW-Debug] Service Worker registration failed:', error);
          });
        }
    });

    navigator.serviceWorker.addEventListener('message', event => {
      console.log('[SW-Debug] Received message from SW:', event.data);
    });
    
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[SW-Debug] Controller changed');
    });
  } else {
    console.log('[SW-Debug] Service Worker not supported');
  }
});

/**
 * Instalación y actualización de la app.
 *
 * Registra el service worker, ofrece el botón de instalar cuando el navegador
 * lo permite y avisa cuando hay una versión nueva del foro, sin recargar por
 * sorpresa mientras alguien está escribiendo.
 */
(function () {
  'use strict';

  const raiz = document.documentElement;
  const enApp =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.navigator.standalone === true;
  if (enApp) raiz.classList.add('is-app');

  const esIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (esIOS) raiz.classList.add('is-ios');

  /* ---------- Botón de instalar ---------- */
  let invitacion = null;
  const botones = () => Array.from(document.querySelectorAll('[data-install]'));

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    invitacion = e;
    botones().forEach((b) => {
      b.hidden = false;
    });
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-install]');
    if (!btn || !invitacion) return;
    e.preventDefault();
    btn.disabled = true;
    try {
      invitacion.prompt();
      await invitacion.userChoice;
    } catch (err) {
      // El navegador ha cancelado la invitación: no hay nada que hacer.
    }
    invitacion = null;
    botones().forEach((b) => {
      b.hidden = true;
    });
  });

  window.addEventListener('appinstalled', () => {
    invitacion = null;
    botones().forEach((b) => {
      b.hidden = true;
    });
  });

  // En iPhone no existe el botón: hay que enseñar el paso a mano.
  if (esIOS && !enApp) {
    document.addEventListener('DOMContentLoaded', () => {
      document.querySelectorAll('[data-install-ios]').forEach((el) => {
        el.hidden = false;
      });
    });
  }

  /* ---------- Service worker ---------- */
  if (!('serviceWorker' in navigator)) return;
  // Sin HTTPS el navegador no lo admite (salvo en el ordenador de desarrollo).
  const seguro = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!seguro) return;

  function avisarDeLaActualizacion(esperando) {
    if (document.getElementById('aviso-version')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'aviso-version';
    btn.className = 'live-pill live-pill-update is-in';
    btn.textContent = 'Hay una versión nueva del foro · Actualizar';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Actualizando…';
      esperando.postMessage('actualizar-ya');
    });
    document.body.appendChild(btn);
  }

  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) avisarDeLaActualizacion(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nuevo = reg.installing;
          if (!nuevo) return;
          nuevo.addEventListener('statechange', () => {
            // Solo si ya había una versión funcionando: la primera vez no es una actualización.
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) avisarDeLaActualizacion(nuevo);
          });
        });
      })
      .catch(() => {
        // Sin service worker el foro funciona igual; simplemente no se instala.
      });
  });
})();

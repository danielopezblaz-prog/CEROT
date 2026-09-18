/* Pantalla de "sin conexión": reintenta sola en cuanto vuelve la cobertura. */
(function () {
  'use strict';
  var volver = function () {
    // history.back() devuelve a lo que el vecino estaba mirando; si no hay
    // historial (app recién abierta), se va a la portada.
    if (document.referrer && document.referrer.indexOf(location.origin) === 0) location.replace(document.referrer);
    else location.replace('/');
  };
  document.getElementById('reintentar').addEventListener('click', volver);
  window.addEventListener('online', volver);
})();

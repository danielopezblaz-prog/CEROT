/**
 * Actualización en vivo.
 *
 * Mantiene una única conexión abierta con el foro y va refrescando lo que hay en
 * pantalla: comentarios nuevos, apoyos, cambios de estado y avisos para la
 * moderación. Si no hay conexión, lo dice y se reengancha solo cuando vuelve.
 *
 * Reglas que se respetan aquí:
 *  - Una pestaña que lleva un rato de fondo suelta la conexión y sigue enterándose
 *    por el canal entre pestañas. Así no se gastan las seis conexiones por sitio
 *    que admite HTTP/1.1 ni se consume batería de balde. Un vistazo rápido a otra
 *    pestaña no corta nada: solo se suelta tras un minuto sin mirar.
 *  - Nunca se recarga nada por sorpresa: si hay novedades, se avisa y decides tú.
 */
(function () {
  'use strict';

  if (!('EventSource' in window)) return;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const postEl = $('[data-live-post]');
  const postId = postEl ? Number(postEl.dataset.livePost) : 0;
  const listaEl = $('[data-live-list]');
  const esPanel = location.pathname.startsWith('/admin');

  let fuente = null;
  let arranque = null;
  let fallos = 0;
  const vistos = new Set();

  /* ---------- Canal entre pestañas ---------- */
  const canal = 'BroadcastChannel' in window ? new BroadcastChannel('foro-vivo') : null;
  if (canal) {
    canal.addEventListener('message', (e) => {
      if (e.data && e.data.id) aplicar(e.data, false);
    });
  }

  /* ---------- Aviso de conexión ---------- */
  const aviso = document.createElement('div');
  aviso.className = 'live-status';
  aviso.setAttribute('role', 'status');
  aviso.hidden = true;
  document.body.appendChild(aviso);

  function estado(texto, clase) {
    if (!texto) {
      aviso.hidden = true;
      return;
    }
    aviso.textContent = texto;
    aviso.className = 'live-status ' + (clase || '');
    aviso.hidden = false;
  }

  /* ---------- Avisos flotantes ---------- */
  function pastilla(id, texto, alPulsar) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.id = id;
      el.className = 'live-pill';
      el.addEventListener('click', alPulsar);
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add('is-in'));
    }
    el.textContent = texto;
    return el;
  }

  /* ---------- Listados: avisar, no recargar por las bravas ---------- */
  let nuevasEnLista = 0;
  function avisarLista(singular, plural) {
    nuevasEnLista += 1;
    const n = nuevasEnLista;
    const texto = n === 1 ? '1 ' + singular + ' nueva · Ver' : n + ' ' + plural + ' nuevas · Ver';
    pastilla('aviso-lista', texto, () => location.reload());
  }

  /* ---------- Ficha de una incidencia ---------- */
  let cargando = false;
  async function traerComentarios() {
    if (!postEl || cargando) return;
    cargando = true;
    try {
      const desde = Number(postEl.dataset.lastComment) || 0;
      const url = '/incidencias/' + encodeURIComponent(postEl.dataset.slug) + '/comentarios/nuevos?desde=' + desde;
      const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const datos = await res.json();
      const contador = $('[data-comment-count]');
      if (contador) contador.textContent = datos.total;
      if (!datos.html) return;

      const lista = $('[data-comments]');
      if (!lista) return;
      lista.hidden = false;
      const vacio = $('[data-comments-empty]');
      if (vacio) vacio.remove();

      const molde = document.createElement('template');
      molde.innerHTML = datos.html;
      const nuevos = Array.from(molde.content.children);
      nuevos.forEach((li) => {
        li.classList.add('is-nuevo');
        lista.appendChild(li);
      });
      postEl.dataset.lastComment = String(datos.ultimo);
      // Se marca un momento para que se vea que ha llegado, sin mover la lectura.
      setTimeout(() => nuevos.forEach((li) => li.classList.remove('is-nuevo')), 5000);
    } catch (err) {
      // Sin conexión: al recargar aparecerán igual.
    } finally {
      cargando = false;
    }
  }

  const ORDEN = ['abierta', 'en_tramite', 'resuelta'];

  function actualizarEstado(ev) {
    const badge = $('[data-status-badge]');
    if (badge) {
      badge.className = 'status status-' + ev.estado;
      badge.textContent = ev.etiqueta;
    }
    // La barra de progreso tiene que decir lo mismo que la etiqueta: dejar una
    // y no la otra da una imagen contradictoria de la incidencia.
    const stepper = $('.stepper');
    const pasos = $$('.stepper .step-item');
    const cerrada = ev.estado === 'cerrada';
    const actual = cerrada ? 2 : ORDEN.indexOf(ev.estado);
    if (stepper && pasos.length === 3 && actual >= 0) {
      stepper.classList.toggle('is-closed', cerrada);
      pasos.forEach((li, i) => {
        li.classList.toggle('is-done', i < actual);
        li.classList.toggle('is-current', i === actual);
      });
      // Al cerrarse, el último paso deja de llamarse «Resuelta».
      const ultimo = pasos[2].querySelector('.step-label');
      if (ultimo && cerrada) ultimo.textContent = 'Cerrada';
    }
    pastilla('aviso-estado', 'Ahora: ' + ev.etiqueta + ' · Ver', () => location.reload());
  }

  function actualizarApoyos(ev) {
    $$('[data-support-for="' + ev.postId + '"] [data-count]').forEach((el) => {
      el.textContent = ev.apoyos;
    });
  }

  /* ---------- Contadores de la moderación ---------- */
  function fijarBadge(sel, n) {
    if (typeof n !== 'number') return;
    $$(sel).forEach((el) => {
      el.textContent = n;
      el.hidden = n === 0;
    });
  }

  /* ---------- Reparto ---------- */
  function aplicar(ev, propagar) {
    if (!ev || vistos.has(ev.id)) return;
    vistos.add(ev.id);
    if (vistos.size > 500) vistos.clear();
    if (propagar && canal) {
      try {
        canal.postMessage(ev);
      } catch (err) {
        // otra pestaña se habrá cerrado: no pasa nada
      }
    }

    const lista = listaEl ? listaEl.dataset.liveList : '';

    switch (ev.tipo) {
      case 'publicacion:nueva':
        if (lista === 'publicaciones') avisarLista('publicación', 'publicaciones');
        break;
      case 'oferta:nueva':
        if (lista === 'ofertas') avisarLista('oferta', 'ofertas');
        break;
      case 'negocio:aprobado':
        if (lista === 'negocios') avisarLista('ficha', 'fichas');
        break;
      case 'comentario:nuevo':
        if (ev.postId === postId) traerComentarios();
        break;
      case 'comentario:fuera': {
        const li = document.getElementById('comentario-' + ev.comentarioId);
        if (li) li.classList.add('is-hidden');
        break;
      }
      case 'apoyo':
        actualizarApoyos(ev);
        break;
      case 'estado':
        if (ev.postId === postId) actualizarEstado(ev);
        break;
      case 'publicacion:editada':
        if (ev.postId === postId) pastilla('aviso-editada', 'Esta publicación se ha actualizado · Ver', () => location.reload());
        break;
      case 'denuncia':
        fijarBadge('[data-badge-denuncias]', ev.pendientes);
        if (esPanel) pastilla('aviso-panel', 'Hay una denuncia nueva · Actualizar', () => location.reload());
        break;
      case 'pendientes':
        fijarBadge('[data-badge-denuncias]', ev.denuncias);
        fijarBadge('[data-badge-negocios]', ev.negocios);
        if (esPanel && ev.nombre) pastilla('aviso-panel', 'Una ficha nueva espera revisión · Actualizar', () => location.reload());
        break;
      default:
        break;
    }
  }

  const TIPOS = [
    'publicacion:nueva', 'publicacion:editada', 'publicacion:moderada',
    'comentario:nuevo', 'comentario:fuera', 'apoyo', 'estado',
    'negocio:aprobado', 'negocio:retirado', 'oferta:nueva', 'denuncia', 'pendientes',
  ];

  /* ---------- Conexión ---------- */
  const ESPERA_EN_SEGUNDO_PLANO = 60000;
  let relojDeFondo = null;

  function conectar() {
    if (fuente) return;
    try {
      fuente = new EventSource('/api/eventos', { withCredentials: true });
    } catch (err) {
      return;
    }

    fuente.addEventListener('open', () => {
      fallos = 0;
      estado(null);
    });

    fuente.addEventListener('hola', (e) => {
      try {
        const datos = JSON.parse(e.data);
        // Si el foro se ha reiniciado, los números empiezan de cero: olvidamos los vistos.
        if (arranque && datos.arranque !== arranque) vistos.clear();
        arranque = datos.arranque;
        // Al volver de un corte, ponerse al día de esta ficha.
        if (fallos > 0 && postEl) traerComentarios();
      } catch (err) {
        // mensaje mal formado: se ignora
      }
    });

    const recibir = (e) => {
      try {
        aplicar(JSON.parse(e.data), true);
      } catch (err) {
        // mensaje mal formado: se ignora
      }
    };
    TIPOS.forEach((tipo) => fuente.addEventListener(tipo, recibir));

    fuente.addEventListener('error', () => {
      fallos += 1;
      // El primer corte suele ser el relevo normal de la conexión: no se avisa.
      if (fallos > 1 || !navigator.onLine) {
        estado(navigator.onLine ? 'Reconectando…' : 'Sin conexión', navigator.onLine ? '' : 'is-offline');
      }
    });
  }

  function desconectar() {
    if (!fuente) return;
    fuente.close();
    fuente = null;
  }

  document.addEventListener('visibilitychange', () => {
    clearTimeout(relojDeFondo);
    if (document.hidden) {
      // Un vistazo a otra pestaña no cuenta: solo se suelta si de verdad se deja.
      relojDeFondo = setTimeout(desconectar, ESPERA_EN_SEGUNDO_PLANO);
    } else {
      conectar();
      // Al volver, ponerse al día de lo que haya pasado mientras tanto.
      if (postEl) traerComentarios();
    }
  });
  window.addEventListener('online', () => {
    estado(null);
    conectar();
  });
  window.addEventListener('offline', () => estado('Sin conexión', 'is-offline'));
  window.addEventListener('pagehide', desconectar);

  conectar();
})();

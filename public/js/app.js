/* Interacción general del foro (sin dependencias). */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const csrfToken = () => ($('input[name="_csrf"]') || {}).value || '';

  /* Menú móvil */
  const toggle = $('[data-nav-toggle]');
  const nav = $('[data-nav]');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* Avisos flash */
  $$('[data-dismiss]').forEach((btn) => btn.addEventListener('click', () => btn.closest('.flash')?.remove()));
  setTimeout(() => $$('.flash-success').forEach((f) => f.remove()), 7000);

  /* Confirmaciones */
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const msg = form.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-confirm][form]');
    if (btn && !window.confirm(btn.getAttribute('data-confirm'))) e.preventDefault();
  });

  /* Selects que envían el formulario al cambiar */
  $$('[data-autosubmit]').forEach((sel) => sel.addEventListener('change', () => sel.form?.requestSubmit()));

  /* Botones de apoyo (sin recargar) */
  $$('[data-support]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      if (!btn || btn.disabled) return;
      btn.disabled = true;
      try {
        const res = await fetch(form.action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken(), 'X-Requested-With': 'fetch', Accept: 'application/json' },
          body: '{}',
          credentials: 'same-origin',
        });
        if (res.status === 401) {
          window.location.href = `/acceder?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
          return;
        }
        if (!res.ok) throw new Error('Error');
        const data = await res.json();
        btn.classList.toggle('is-active', data.supported);
        btn.setAttribute('aria-pressed', data.supported ? 'true' : 'false');
        btn.classList.remove('is-bump');
        void btn.offsetWidth;
        btn.classList.add('is-bump');
        const count = btn.querySelector('[data-count]');
        if (count) count.textContent = data.count;
        const label = btn.querySelector('[data-label]');
        if (label) label.textContent = data.supported ? 'Ya lo apoyas' : 'Me afecta / lo apoyo';
        btn.title = data.supported ? 'Retirar apoyo' : 'Apoyar: a mí también me afecta';
      } catch {
        form.submit();
      } finally {
        btn.disabled = false;
      }
    });
  });

  /* Copiar enlace */
  $$('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = btn.getAttribute('data-copy');
      const label = btn.querySelector('[data-copy-label]');
      try {
        await navigator.clipboard.writeText(text);
        btn.classList.add('is-copied');
        if (label) label.textContent = '¡Copiado!';
        setTimeout(() => {
          btn.classList.remove('is-copied');
          if (label) label.textContent = 'Copiar enlace';
        }, 2200);
      } catch {
        window.prompt('Copia el enlace:', text);
      }
    });
  });

  /* Compartir nativo en móviles */
  const share = $('[data-share]');
  if (share && navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'share-btn';
    btn.textContent = 'Más…';
    btn.addEventListener('click', () => navigator.share({ title: share.dataset.title, url: share.dataset.url }).catch(() => {}));
    share.appendChild(btn);
  }

  /* Imprimir */
  $$('[data-print]').forEach((btn) => btn.addEventListener('click', () => window.print()));

  /* Contadores de caracteres */
  $$('[data-counter]').forEach((el) => {
    const max = Number(el.getAttribute('maxlength'));
    if (!max) return;
    const out = document.createElement('div');
    out.className = 'counter';
    el.insertAdjacentElement('afterend', out);
    const update = () => {
      out.textContent = `${el.value.length} / ${max}`;
      out.classList.toggle('is-over', el.value.length >= max);
    };
    el.addEventListener('input', update);
    update();
  });

  /* Mostrar/ocultar bloques con checkbox */
  $$('[data-toggle-target]').forEach((cb) => {
    const target = $(cb.getAttribute('data-toggle-target'));
    if (!target) return;
    const sync = () => {
      target.hidden = !cb.checked;
    };
    cb.addEventListener('change', sync);
    sync();
  });

  /* Desplegables: cerrar los demás y al hacer clic fuera */
  $$('details.dropdown').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (d.open) $$('details.dropdown[open]').forEach((o) => o !== d && (o.open = false));
    });
  });
  document.addEventListener('click', (e) => {
    $$('details.dropdown[open]').forEach((d) => {
      if (!d.contains(e.target)) d.open = false;
    });
  });

  /* Vista previa de fotos antes de subir */
  $$('[data-file-drop]').forEach((drop) => {
    const input = drop.querySelector('input[type="file"]');
    const preview = drop.parentElement.querySelector('[data-file-preview]');
    if (!input || !preview) return;
    const max = Number(input.dataset.max) || 4;
    const maxMb = Number(input.dataset.maxMb) || 8;
    let error = drop.parentElement.querySelector('.file-error');
    const render = () => {
      preview.innerHTML = '';
      if (error) error.remove();
      const files = Array.from(input.files || []);
      const problems = [];
      if (files.length > max) problems.push(`Solo puedes subir ${max} fotos.`);
      files.forEach((f) => {
        if (f.size > maxMb * 1024 * 1024) problems.push(`«${f.name}» pesa más de ${maxMb} MB.`);
        if (!/^image\/(jpeg|png|webp|gif)$/.test(f.type)) problems.push(`«${f.name}» no es JPG, PNG, WebP o GIF.`);
      });
      if (problems.length) {
        error = document.createElement('p');
        error.className = 'file-error';
        error.textContent = problems.join(' ');
        preview.insertAdjacentElement('afterend', error);
        input.value = '';
        return;
      }
      files.forEach((f) => {
        const fig = document.createElement('figure');
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.onload = () => URL.revokeObjectURL(img.src);
        const cap = document.createElement('figcaption');
        cap.textContent = f.name;
        fig.append(img, cap);
        preview.appendChild(fig);
      });
    };
    input.addEventListener('change', render);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-dragover'); }));
    drop.addEventListener('drop', (e) => {
      if (e.dataTransfer?.files?.length) {
        input.files = e.dataTransfer.files;
        render();
      }
    });
  });

  /* Catálogo: al elegir una foto nueva en una fila, se ve al momento */
  $$('[data-row-photo]').forEach((input) => {
    input.addEventListener('change', () => {
      const wrap = input.closest('.product-row-photo');
      const file = input.files && input.files[0];
      if (!wrap || !file) return;
      let img = wrap.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        wrap.querySelector('.product-row-nophoto')?.remove();
        wrap.prepend(img);
      }
      img.src = URL.createObjectURL(file);
      img.onload = () => URL.revokeObjectURL(img.src);
      wrap.classList.add('is-changed');
    });
  });

  /* Horario del local: atenuar los días cerrados y copiar el horario del lunes */
  $$('[data-hours-row]').forEach((row) => {
    const cb = row.querySelector('[data-hours-closed]');
    if (!cb) return;
    const sync = () => {
      row.classList.toggle('is-closed', cb.checked);
      row.querySelectorAll('input[type="time"]').forEach((t) => { t.disabled = cb.checked; });
    };
    cb.addEventListener('change', sync);
    row.querySelectorAll('input[type="time"]').forEach((t) => {
      t.addEventListener('input', () => {
        if (t.value && cb.checked) {
          cb.checked = false;
          sync();
        }
      });
    });
    sync();
  });
  const copyHours = $('[data-copy-hours]');
  if (copyHours) {
    copyHours.addEventListener('click', () => {
      const rows = $$('[data-hours-row]');
      if (rows.length < 5) return;
      const source = rows[0];
      const values = ['desde1', 'hasta1', 'desde2', 'hasta2'].map((n) => source.querySelector(`input[name^="${n}_"]`)?.value ?? '');
      const closed = source.querySelector('[data-hours-closed]').checked;
      for (let i = 1; i < 5; i += 1) {
        const cb = rows[i].querySelector('[data-hours-closed]');
        cb.checked = closed;
        ['desde1', 'hasta1', 'desde2', 'hasta2'].forEach((n, k) => {
          const input = rows[i].querySelector(`input[name^="${n}_"]`);
          if (input) input.value = values[k];
        });
        cb.dispatchEvent(new Event('change'));
      }
    });
  }

  /* Formulario de oferta: la hora solo tiene sentido en los eventos */
  const offerTypes = $$('[data-offer-type]');
  if (offerTypes.length) {
    const timeField = $('[data-event-time]');
    const dateLabel = $('[data-date-label]');
    const sync = () => {
      const selected = offerTypes.find((r) => r.checked)?.value;
      if (timeField) timeField.hidden = selected !== 'evento';
      if (dateLabel) dateLabel.textContent = selected === 'evento' ? 'Fecha del evento' : 'Desde';
    };
    offerTypes.forEach((r) => r.addEventListener('change', sync));
    sync();
  }

  /* Miniaturas de mapa en las tarjetas (mosaico de teselas de OpenStreetMap centrado en el punto) */
  const thumbs = $$('[data-map-thumb]');
  if (thumbs.length) {
    const ZOOM = 16;
    const build = (el) => {
      if (el.dataset.built) return;
      const lat = Number(el.dataset.lat);
      const lng = Number(el.dataset.lng);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      el.dataset.built = '1';
      const n = 2 ** ZOOM;
      const latR = (lat * Math.PI) / 180;
      const px = ((lng + 180) / 360) * n * 256;
      const py = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n * 256;
      const left = px - w / 2;
      const top = py - h / 2;
      const tx0 = Math.floor(left / 256);
      const tx1 = Math.floor((left + w - 1) / 256);
      const ty0 = Math.floor(top / 256);
      const ty1 = Math.floor((top + h - 1) / 256);
      let pending = 0;
      for (let tx = tx0; tx <= tx1; tx += 1) {
        for (let ty = ty0; ty <= ty1; ty += 1) {
          const img = document.createElement('img');
          img.alt = '';
          img.decoding = 'async';
          img.style.left = `${tx * 256 - left}px`;
          img.style.top = `${ty * 256 - top}px`;
          img.src = `/planos/${ZOOM}/${tx}/${ty}.png`;
          pending += 1;
          img.addEventListener('load', () => {
            pending -= 1;
            if (pending === 0) el.classList.add('is-ready');
          });
          img.addEventListener('error', () => { pending -= 1; });
          el.insertBefore(img, el.firstChild);
        }
      }
    };
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            build(e.target);
            io.unobserve(e.target);
          }
        });
      }, { rootMargin: '200px' });
      thumbs.forEach((t) => io.observe(t));
    } else {
      thumbs.forEach(build);
    }
  }

  /* Lightbox de la galería */
  const box = $('[data-lightbox-root]');
  if (box) {
    const img = box.querySelector('img');
    const cap = box.querySelector('.lightbox-caption');
    const close = () => { box.hidden = true; document.body.style.overflow = ''; };
    $$('[data-lightbox]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        img.src = a.href;
        img.alt = a.dataset.caption || '';
        cap.textContent = a.dataset.caption || '';
        box.hidden = false;
        document.body.style.overflow = 'hidden';
      });
    });
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-lightbox-close]')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) close(); });
  }
})();

/* Un solo envío por formulario.
   En el móvil es muy fácil tocar dos veces «Publicar» y acabar con el
   comentario o la incidencia duplicados. El botón se marca como ocupado justo
   después de que el navegador haya recogido los datos, nunca antes. */
(function () {
  'use strict';

  const botonesDe = (form) => Array.from(form.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]'));

  function liberar(form) {
    delete form.dataset.enviando;
    botonesDe(form).forEach((b) => {
      b.disabled = false;
      b.removeAttribute('aria-busy');
    });
  }

  document.addEventListener('submit', (e) => {
    // Si otro manejador lo ha parado (una confirmación, o un envío por fetch),
    // aquí no hay nada que bloquear.
    if (e.defaultPrevented) return;
    const form = e.target;
    if (form.dataset.enviando) {
      e.preventDefault();
      return;
    }
    form.dataset.enviando = '1';
    const botones = botonesDe(form);
    setTimeout(() => {
      botones.forEach((b) => {
        b.setAttribute('aria-busy', 'true');
        b.disabled = true;
      });
    }, 0);
    // Red de seguridad: si la respuesta no llega, no dejamos el botón muerto.
    setTimeout(() => liberar(form), 20000);
  });

  // Al volver con la flecha «atrás», el navegador restaura la página tal cual
  // estaba: hay que devolver los botones a su sitio.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) Array.from(document.forms).forEach(liberar);
  });
})();

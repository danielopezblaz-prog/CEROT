/* Mapas con Leaflet: marcadores de incidencias y punto de una publicación. */
(function () {
  'use strict';
  if (typeof L === 'undefined') return;

  const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const COLORS = { abierta: '#dc2626', en_tramite: '#b45309', resuelta: '#15803d', cerrada: '#475569' };

  let categoryIcons = {};
  try {
    const raw = document.getElementById('category-icons');
    if (raw) categoryIcons = JSON.parse(raw.textContent);
  } catch {
    categoryIcons = {};
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function baseMap(el) {
    const map = L.map(el, { scrollWheelZoom: false }).setView([Number(el.dataset.lat), Number(el.dataset.lng)], Number(el.dataset.zoom) || 15);
    L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19 }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.on('focus', () => map.scrollWheelZoom.enable());
    map.on('blur', () => map.scrollWheelZoom.disable());
    return map;
  }

  /** Marcador con forma de gota, color según estado e icono de la categoría. */
  function pinIcon(status, categorySlug, size = 38) {
    const color = COLORS[status] || '#0f5c4c';
    const body = categoryIcons[categorySlug] || categoryIcons.otros || '';
    const w = size;
    const h = Math.round(size * 1.32);
    const html =
      `<div class="pin-marker" style="width:${w}px;height:${h}px;color:${color}">` +
      `<svg viewBox="0 0 24 32" width="${w}" height="${h}" aria-hidden="true"><path d="M12 1C6 1 1.5 5.6 1.5 11.5 1.5 19.5 12 31 12 31s10.5-11.5 10.5-19.5C22.5 5.6 18 1 12 1z" fill="currentColor" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="11.5" r="7" fill="#fff"/></svg>` +
      `<svg class="pin-marker-icon" viewBox="0 0 24 24" width="${Math.round(w * 0.42)}" height="${Math.round(w * 0.42)}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>` +
      `</div>`;
    return L.divIcon({ className: 'pin-marker-wrap', html, iconSize: [w, h], iconAnchor: [w / 2, h - 2], popupAnchor: [0, -h + 6] });
  }
  window.VeredaMap = { baseMap, pinIcon };

  /* Mapa con marcadores (portada y /mapa) */
  const markersEl = document.querySelector('[data-map-markers]');
  if (markersEl) {
    const map = baseMap(markersEl);
    fetch(markersEl.dataset.mapMarkers, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((data) => {
        const group = L.featureGroup();
        data.markers.forEach((m) => {
          const marker = L.marker([m.lat, m.lng], { icon: pinIcon(m.status, m.categorySlug), title: m.title, riseOnHover: true });
          marker.bindPopup(
            `<a class="popup-title" href="/incidencias/${esc(m.slug)}">${esc(m.title)}</a>` +
              `<div class="popup-meta"><span class="status status-${esc(m.status)} status-sm">${esc(m.statusLabel)}</span> <span class="chip">${esc(m.category)}</span></div>` +
              (m.location ? `<div class="muted small">${esc(m.location)}</div>` : '') +
              `<div class="popup-counts"><span>👍 ${m.supports}</span> <span>💬 ${m.comments}</span></div>` +
              `<a class="popup-link" href="/incidencias/${esc(m.slug)}">Ver publicación →</a>`,
            { maxWidth: 280 }
          );
          group.addLayer(marker);
        });
        group.addTo(map);
        if (markersEl.dataset.fit === '1' && data.markers.length) {
          map.fitBounds(group.getBounds().pad(0.15), { maxZoom: 16 });
        }
      })
      .catch(() => {});
  }

  /* Mapa de comercios del barrio */
  const bizEl = document.querySelector('[data-map-business]');
  if (bizEl) {
    let bizIcons = {};
    try {
      const raw = document.getElementById('business-icons');
      if (raw) bizIcons = JSON.parse(raw.textContent);
    } catch {
      bizIcons = {};
    }
    const bizPin = (color, slug, size = 38) => {
      const body = bizIcons[slug] || bizIcons.otros || '';
      const h = Math.round(size * 1.32);
      return L.divIcon({
        className: 'pin-marker-wrap',
        html:
          `<div class="pin-marker" style="width:${size}px;height:${h}px;color:${color}">` +
          `<svg viewBox="0 0 24 32" width="${size}" height="${h}" aria-hidden="true"><path d="M12 1C6 1 1.5 5.6 1.5 11.5 1.5 19.5 12 31 12 31s10.5-11.5 10.5-19.5C22.5 5.6 18 1 12 1z" fill="currentColor" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="11.5" r="7" fill="#fff"/></svg>` +
          `<svg class="pin-marker-icon" viewBox="0 0 24 24" width="${Math.round(size * 0.42)}" height="${Math.round(size * 0.42)}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg></div>`,
        iconSize: [size, h],
        iconAnchor: [size / 2, h - 2],
        popupAnchor: [0, -h + 6],
      });
    };
    const map = baseMap(bizEl);
    fetch(bizEl.dataset.mapBusiness, { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((data) => {
        const group = L.featureGroup();
        data.markers.forEach((m) => {
          const marker = L.marker([m.lat, m.lng], { icon: bizPin(m.color, m.category), title: m.name, riseOnHover: true });
          marker.bindPopup(
            `<a class="popup-title" href="/negocios/${esc(m.slug)}">${esc(m.name)}</a>` +
              `<div class="popup-meta"><span class="chip">${esc(m.categoryName)}</span>${m.offers ? `<span class="chip chip-offer">${m.offers} oferta${m.offers === 1 ? '' : 's'}</span>` : ''}</div>` +
              (m.shortDesc ? `<div class="muted small">${esc(m.shortDesc)}</div>` : '') +
              (m.address ? `<div class="muted small">${esc(m.address)}</div>` : '') +
              `<a class="popup-link" href="/negocios/${esc(m.slug)}">Ver el local →</a>`,
            { maxWidth: 280 }
          );
          group.addLayer(marker);
        });
        group.addTo(map);
        if (bizEl.dataset.fit === '1' && data.markers.length) map.fitBounds(group.getBounds().pad(0.15), { maxZoom: 16 });
      })
      .catch(() => {});
  }

  /* Mapa de una publicación */
  const pointEl = document.querySelector('[data-map-point]');
  if (pointEl) {
    const map = baseMap(pointEl);
    const latlng = [Number(pointEl.dataset.lat), Number(pointEl.dataset.lng)];
    const color = COLORS[pointEl.dataset.status] || '#0f5c4c';
    L.circle(latlng, { radius: 45, color, weight: 1, fillOpacity: 0.1 }).addTo(map);
    L.marker(latlng, { icon: pinIcon(pointEl.dataset.status, pointEl.dataset.category, 44) }).addTo(map).bindPopup(esc(pointEl.dataset.title));
  }
})();

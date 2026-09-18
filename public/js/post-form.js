/* Selector de ubicación del formulario de publicación. */
(function () {
  'use strict';
  const el = document.querySelector('[data-map-picker]');
  if (!el || typeof L === 'undefined' || !window.VeredaMap) return;

  const latInput = document.querySelector('[data-lat-input]');
  const lngInput = document.querySelector('[data-lng-input]');
  const status = document.querySelector('[data-location-status]');
  const clearBtn = document.querySelector('[data-clear-point]');
  const geoBtn = document.querySelector('[data-geolocate]');
  const searchInput = document.querySelector('[data-geocode-input]');
  const searchBtn = document.querySelector('[data-geocode-btn]');
  const addressInput = document.querySelector('input[name="ubicacion"]');

  const map = window.VeredaMap.baseMap(el);
  let marker = null;

  function setPoint(latlng, { pan = false, zoom = null } = {}) {
    const lat = Number(latlng.lat.toFixed(6));
    const lng = Number(latlng.lng.toFixed(6));
    if (!marker) {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map);
      marker.on('dragend', () => setPoint(marker.getLatLng()));
    } else {
      marker.setLatLng([lat, lng]);
    }
    latInput.value = lat;
    lngInput.value = lng;
    status.textContent = `Ubicación marcada (${lat}, ${lng}). Arrastra el marcador para ajustarla.`;
    status.parentElement.classList.add('is-set');
    clearBtn.hidden = false;
    if (pan) map.setView([lat, lng], zoom || Math.max(map.getZoom(), 17));
  }

  function clearPoint() {
    if (marker) {
      map.removeLayer(marker);
      marker = null;
    }
    latInput.value = '';
    lngInput.value = '';
    status.textContent = 'Toca el mapa para marcar el punto exacto (opcional pero muy útil).';
    status.parentElement.classList.remove('is-set');
    clearBtn.hidden = true;
  }

  if (el.dataset.hasPoint === '1' && latInput.value && lngInput.value) {
    setPoint({ lat: Number(latInput.value), lng: Number(lngInput.value) });
  }

  map.on('click', (e) => setPoint(e.latlng));
  clearBtn.addEventListener('click', clearPoint);

  geoBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      status.textContent = 'Tu navegador no permite obtener la ubicación.';
      return;
    }
    geoBtn.disabled = true;
    status.textContent = 'Obteniendo tu ubicación…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geoBtn.disabled = false;
        setPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude }, { pan: true, zoom: 17 });
      },
      () => {
        geoBtn.disabled = false;
        status.textContent = 'No se ha podido obtener la ubicación. Marca el punto en el mapa.';
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  async function geocode() {
    const q = (searchInput.value || '').trim();
    if (q.length < 3) return;
    searchBtn.disabled = true;
    status.textContent = 'Buscando dirección…';
    try {
      const c = map.getCenter();
      const d = 0.06;
      const viewbox = `${c.lng - d},${c.lat + d},${c.lng + d},${c.lat - d}`;
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=es&countrycodes=es&viewbox=${viewbox}&bounded=1&q=${encodeURIComponent(q)}`;
      let res = await fetch(url, { headers: { Accept: 'application/json' } });
      let data = await res.json();
      if (!data.length) {
        res = await fetch(url.replace('&bounded=1', ''), { headers: { Accept: 'application/json' } });
        data = await res.json();
      }
      if (!data.length) {
        status.textContent = 'No se ha encontrado esa dirección. Prueba con «calle, número, Leganés» o marca el punto en el mapa.';
        return;
      }
      const hit = data[0];
      setPoint({ lat: Number(hit.lat), lng: Number(hit.lon) }, { pan: true, zoom: 17 });
      if (addressInput && !addressInput.value.trim()) {
        addressInput.value = hit.display_name.split(',').slice(0, 2).join(',').trim();
      }
    } catch {
      status.textContent = 'No se ha podido buscar la dirección. Marca el punto en el mapa.';
    } finally {
      searchBtn.disabled = false;
    }
  }
  searchBtn.addEventListener('click', geocode);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      geocode();
    }
  });
})();

const SHIP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 19 21l-7-3-7 3L12 1.8Z"/></svg>';
const DEMO_SHIPS = [
  { mmsi: '367742220', name: 'PACIFIC MERIDIAN', lat: 37.801, lon: -122.405, sog: 11.8, cog: 247, heading: 249, status: 'Under way using engine', type: 'Cargo', drift: [-.00012, -.0005] },
  { mmsi: '368084090', name: 'POINT BONITA', lat: 37.842, lon: -122.469, sog: 0.2, cog: 12, heading: 18, status: 'Moored', type: 'Tug', drift: [.00001, .00001] },
  { mmsi: '477995616', name: 'EVER LOTUS', lat: 37.703, lon: -122.529, sog: 14.3, cog: 78, heading: 81, status: 'Under way using engine', type: 'Cargo', drift: [.00009, .00054] },
  { mmsi: '338297000', name: 'SEA CHANGE', lat: 37.785, lon: -122.333, sog: 6.1, cog: 192, heading: 189, status: 'Under way using engine', type: 'Passenger', drift: [-.00038, -.00008] },
  { mmsi: '367060550', name: 'BAY VOYAGER', lat: 37.909, lon: -122.438, sog: 8.4, cog: 151, heading: 153, status: 'Under way using engine', type: 'Passenger', drift: [-.00034, .00017] },
  { mmsi: '366988860', name: 'GOLDEN GATE', lat: 37.827, lon: -122.357, sog: 0, cog: 0, heading: 340, status: 'At anchor', type: 'Cargo', drift: [0, 0] },
  { mmsi: '636021141', name: 'NORDIC BREEZE', lat: 37.645, lon: -122.589, sog: 12.6, cog: 41, heading: 43, status: 'Under way using engine', type: 'Tanker', drift: [.00034, .0003] },
  { mmsi: '367719770', name: 'RESOLVE PIONEER', lat: 37.754, lon: -122.623, sog: 4.7, cog: 98, heading: 101, status: 'Restricted maneuverability', type: 'Other', drift: [-.00003, .00033] },
  { mmsi: '367153520', name: 'MARINER', lat: 37.937, lon: -122.412, sog: 7.2, cog: 223, heading: 225, status: 'Under way using engine', type: 'Pleasure craft', drift: [-.00028, -.00028] }
];

const state = {
  vessels: new Map(), markers: new Map(), socket: null, demoTimer: null,
  selectedMmsi: null, filter: 'all', search: '', mode: 'demo'
};

const els = Object.fromEntries([
  'vesselCount','allCount','vesselList','searchInput','selectionCard','connectionPill','connectionText',
  'connectButton','connectModal','connectForm','closeModal','toggleKey','apiKey','clearButton','fitButton',
  'locateButton','sidebar','openSidebar','closeSidebar','toastRegion'
].map(id => [id, document.getElementById(id)]));

const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([37.795, -122.44], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);
L.control.zoom({ position: 'topright' }).addTo(map);

function clean(value, fallback = '—') {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) return fallback;
  return String(value).trim() || fallback;
}

function formatAge(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 8) return 'NOW';
  if (seconds < 60) return `${seconds} SEC`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} MIN`;
  return `${Math.floor(seconds / 3600)} HR`;
}

function isStopped(vessel) { return Number(vessel.sog) < 0.5 || /anchor|moored|aground/i.test(vessel.status); }
function isStale(vessel) { return Date.now() - vessel.updatedAt.getTime() > 10 * 60 * 1000; }

function markerClass(vessel) {
  if (isStale(vessel)) return 'stale';
  return isStopped(vessel) ? 'stopped' : 'moving';
}

function shipIcon(vessel, selected = false) {
  const status = markerClass(vessel);
  return L.divIcon({
    className: `ship-marker${selected ? ' is-selected' : ''}`,
    html: `<div class="ship-marker-inner ${status}" style="--heading:${Number(vessel.heading) || Number(vessel.cog) || 0}deg">${SHIP_SVG}</div>`,
    iconSize: [31, 31], iconAnchor: [15.5, 15.5]
  });
}

function upsertVessel(raw) {
  if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return;
  const existing = state.vessels.get(raw.mmsi) || {};
  const vessel = { ...existing, ...raw, updatedAt: raw.updatedAt || new Date() };
  state.vessels.set(vessel.mmsi, vessel);

  let marker = state.markers.get(vessel.mmsi);
  if (!marker) {
    marker = L.marker([vessel.lat, vessel.lon], { icon: shipIcon(vessel) })
      .addTo(map)
      .on('click', () => selectVessel(vessel.mmsi, false));
    state.markers.set(vessel.mmsi, marker);
  } else {
    marker.setLatLng([vessel.lat, vessel.lon]);
    marker.setIcon(shipIcon(vessel, state.selectedMmsi === vessel.mmsi));
  }
}

function visibleVessels() {
  const query = state.search.toLowerCase();
  return [...state.vessels.values()]
    .filter(v => !query || v.name.toLowerCase().includes(query) || v.mmsi.includes(query))
    .filter(v => state.filter === 'all' || (state.filter === 'stopped' ? isStopped(v) : !isStopped(v)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function updateVisibility() {
  const visibleIds = new Set(visibleVessels().map(v => v.mmsi));
  state.markers.forEach((marker, mmsi) => {
    if (visibleIds.has(mmsi) && !map.hasLayer(marker)) marker.addTo(map);
    if (!visibleIds.has(mmsi) && map.hasLayer(marker)) marker.remove();
  });
}

function renderList() {
  const visible = visibleVessels();
  els.vesselCount.textContent = visible.length;
  els.allCount.textContent = state.vessels.size;
  if (!visible.length) {
    els.vesselList.innerHTML = '<div class="empty-state">No vessels match this view.<br />Try another search or filter.</div>';
  } else {
    els.vesselList.innerHTML = visible.map(v => `
      <button class="vessel-row ${state.selectedMmsi === v.mmsi ? 'is-active' : ''}" data-mmsi="${v.mmsi}" type="button">
        <span class="vessel-icon ${isStopped(v) ? 'stopped' : ''}" style="--heading:${Number(v.heading) || Number(v.cog) || 0}deg">${SHIP_SVG}</span>
        <span class="vessel-main"><span class="vessel-name">${escapeHtml(v.name)}</span><span class="vessel-meta">MMSI ${v.mmsi} · ${escapeHtml(v.type)}</span></span>
        <span class="vessel-report"><strong>${formatAge(v.updatedAt)}</strong><span>${Number(v.sog).toFixed(1)} KN</span></span>
      </button>`).join('');
  }
  updateVisibility();
  if (state.selectedMmsi) renderSelection();
}

function renderSelection() {
  const v = state.vessels.get(state.selectedMmsi);
  if (!v) { els.selectionCard.classList.add('is-hidden'); return; }
  els.selectionCard.innerHTML = `
    <div class="selection-head">
      <span class="vessel-icon ${isStopped(v) ? 'stopped' : ''}" style="--heading:${Number(v.heading) || Number(v.cog) || 0}deg">${SHIP_SVG}</span>
      <div class="selection-title"><h2>${escapeHtml(v.name)}</h2><p>MMSI ${v.mmsi} · ${escapeHtml(v.type)}</p></div>
      <button class="close-card" type="button" aria-label="Close details">×</button>
    </div>
    <div class="stat-grid">
      <div class="stat"><small>SPEED</small><strong>${Number(v.sog).toFixed(1)} kn</strong></div>
      <div class="stat"><small>COURSE</small><strong>${Math.round(Number(v.cog) || 0)}°</strong></div>
      <div class="stat"><small>HEADING</small><strong>${Math.round(Number(v.heading) || 0)}°</strong></div>
    </div>
    <div class="position-line"><span>${escapeHtml(v.status)}</span><span>${v.lat.toFixed(4)}, ${v.lon.toFixed(4)}</span></div>`;
  els.selectionCard.classList.remove('is-hidden');
  els.selectionCard.querySelector('.close-card').addEventListener('click', clearSelection);
}

function selectVessel(mmsi, fly = true) {
  if (state.selectedMmsi && state.markers.has(state.selectedMmsi)) {
    const old = state.vessels.get(state.selectedMmsi);
    state.markers.get(state.selectedMmsi).setIcon(shipIcon(old, false));
  }
  state.selectedMmsi = mmsi;
  const vessel = state.vessels.get(mmsi);
  state.markers.get(mmsi)?.setIcon(shipIcon(vessel, true));
  if (fly) map.flyTo([vessel.lat, vessel.lon], Math.max(map.getZoom(), 13), { duration: .6 });
  renderList();
  els.sidebar.classList.remove('is-open');
}

function clearSelection() {
  if (state.selectedMmsi && state.markers.has(state.selectedMmsi)) {
    const vessel = state.vessels.get(state.selectedMmsi);
    state.markers.get(state.selectedMmsi).setIcon(shipIcon(vessel, false));
  }
  state.selectedMmsi = null;
  els.selectionCard.classList.add('is-hidden');
  renderList();
}

function escapeHtml(value) {
  const node = document.createElement('span');
  node.textContent = clean(value);
  return node.innerHTML;
}

function clearVessels() {
  state.markers.forEach(marker => marker.remove());
  state.markers.clear();
  state.vessels.clear();
  state.selectedMmsi = null;
  els.selectionCard.classList.add('is-hidden');
  renderList();
}

function setConnection(mode, text) {
  state.mode = mode;
  els.connectionPill.className = `connection-pill is-${mode}`;
  els.connectionText.textContent = text;
  els.connectButton.lastChild.textContent = mode === 'live' ? ' Disconnect' : ' Connect live';
  els.connectButton.dataset.mobileLabel = mode === 'live' ? 'DISCONNECT' : 'LIVE';
}

function startDemo() {
  stopFeeds();
  clearVessels();
  setConnection('demo', 'Demo feed');
  DEMO_SHIPS.forEach((ship, i) => upsertVessel({ ...ship, updatedAt: new Date(Date.now() - i * 7000) }));
  renderList();
  state.demoTimer = setInterval(() => {
    state.vessels.forEach(v => {
      const source = DEMO_SHIPS.find(s => s.mmsi === v.mmsi);
      if (!source) return;
      const jitter = () => (Math.random() - .5) * .00004;
      upsertVessel({ ...v, lat: v.lat + source.drift[0] + jitter(), lon: v.lon + source.drift[1] + jitter(), updatedAt: new Date() });
    });
    renderList();
  }, 4000);
}

function stopFeeds() {
  clearInterval(state.demoTimer);
  state.demoTimer = null;
  if (state.socket) {
    state.socket.onclose = null;
    state.socket.close();
    state.socket = null;
  }
}

function connectLive(apiKey, area) {
  stopFeeds();
  clearVessels();
  setConnection('demo', 'Connecting…');
  const socket = new WebSocket('wss://stream.aisstream.io/v0/stream');
  state.socket = socket;
  socket.onopen = () => {
    const bounds = area === 'world'
      ? [[[-90, -180], [90, 180]]]
      : [[[map.getBounds().getSouth(), map.getBounds().getWest()], [map.getBounds().getNorth(), map.getBounds().getEast()]]];
    socket.send(JSON.stringify({ APIKey: apiKey, BoundingBoxes: bounds, FilterMessageTypes: ['PositionReport'] }));
    setConnection('live', 'Live feed');
    els.connectModal.classList.add('is-hidden');
    els.apiKey.value = '';
    showToast('Live AIS connection established.');
  };
  socket.onmessage = event => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.error) throw new Error(payload.error);
      const meta = payload.MetaData || {};
      const report = payload.Message?.PositionReport;
      if (!report) return;
      upsertVessel({
        mmsi: String(meta.MMSI ?? report.UserID ?? 'Unknown'),
        name: clean(meta.ShipName, `VESSEL ${meta.MMSI ?? ''}`),
        lat: Number(meta.latitude ?? report.Latitude),
        lon: Number(meta.longitude ?? report.Longitude),
        sog: Number(report.Sog ?? 0), cog: Number(report.Cog ?? 0),
        heading: Number(report.TrueHeading ?? report.Cog ?? 0),
        status: navStatus(report.NavigationalStatus), type: 'AIS contact',
        updatedAt: meta.time_utc ? new Date(meta.time_utc) : new Date()
      });
      renderList();
    } catch (error) {
      showToast(error.message || 'Could not read an AIS report.', true);
    }
  };
  socket.onerror = () => {
    setConnection('error', 'Connection error');
    showToast('AISStream connection failed. Check the key and try again.', true);
  };
  socket.onclose = event => {
    if (state.socket !== socket) return;
    state.socket = null;
    if (event.code !== 1000) showToast('Live feed disconnected. Demo mode resumed.', true);
    startDemo();
  };
}

function navStatus(code) {
  const statuses = ['Under way using engine','At anchor','Not under command','Restricted maneuverability','Constrained by draught','Moored','Aground','Engaged in fishing','Under way sailing'];
  return statuses[Number(code)] || 'Status not available';
}

function fitVessels() {
  const visible = visibleVessels();
  if (!visible.length) return showToast('No vessels to fit on the map.');
  map.fitBounds(L.latLngBounds(visible.map(v => [v.lat, v.lon])), { padding: [55, 55], maxZoom: 13 });
}

function showToast(message, error = false) {
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' error' : ''}`;
  toast.textContent = message;
  els.toastRegion.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

els.vesselList.addEventListener('click', event => {
  const row = event.target.closest('.vessel-row');
  if (row) selectVessel(row.dataset.mmsi);
});
els.searchInput.addEventListener('input', event => { state.search = event.target.value.trim(); renderList(); });
document.querySelectorAll('.filter-chip').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('is-active'));
  button.classList.add('is-active'); state.filter = button.dataset.filter; renderList();
}));
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); els.searchInput.focus(); }
  if (event.key === 'Escape') { els.connectModal.classList.add('is-hidden'); clearSelection(); }
});
els.connectButton.addEventListener('click', () => {
  if (state.mode === 'live') { startDemo(); showToast('Live feed disconnected.'); }
  else { els.connectModal.classList.remove('is-hidden'); setTimeout(() => els.apiKey.focus(), 100); }
});
els.closeModal.addEventListener('click', () => els.connectModal.classList.add('is-hidden'));
els.connectModal.addEventListener('click', e => { if (e.target === els.connectModal) els.connectModal.classList.add('is-hidden'); });
els.toggleKey.addEventListener('click', () => {
  const show = els.apiKey.type === 'password'; els.apiKey.type = show ? 'text' : 'password'; els.toggleKey.textContent = show ? 'Hide' : 'Show';
});
els.connectForm.addEventListener('submit', event => {
  event.preventDefault();
  connectLive(els.apiKey.value.trim(), new FormData(event.currentTarget).get('area'));
});
els.clearButton.addEventListener('click', () => { clearVessels(); showToast('Vessel tracks cleared.'); });
els.fitButton.addEventListener('click', fitVessels);
els.locateButton.addEventListener('click', () => {
  if (!navigator.geolocation) return showToast('Location is not available in this browser.', true);
  navigator.geolocation.getCurrentPosition(
    pos => map.flyTo([pos.coords.latitude, pos.coords.longitude], 11),
    () => showToast('Location access was not available.', true), { enableHighAccuracy: false, timeout: 8000 }
  );
});
els.openSidebar.addEventListener('click', () => els.sidebar.classList.add('is-open'));
els.closeSidebar.addEventListener('click', () => els.sidebar.classList.remove('is-open'));
map.on('click', clearSelection);

startDemo();
setInterval(renderList, 15000);

const SHIP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 19 21l-7-3-7 3L12 1.8Z"/></svg>';
const TRACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 18c2.4-7.2 4.8-1.6 7.2-8.3S17 8 19 4"/><circle cx="5" cy="18" r="1.5"/><circle cx="19" cy="4" r="1.5"/></svg>';
const STALE_AFTER_MS = 10 * 60 * 1000;
const EXPIRE_AFTER_MS = 60 * 60 * 1000;
const MAX_TRACK_POINTS = 60;
const MAX_RECONNECT_ATTEMPTS = 7;
const SOCKET_URL = 'wss://stream.aisstream.io/v0/stream';

const DEMO_SHIPS = [
  { mmsi: '367742220', name: 'PACIFIC MERIDIAN', lat: 37.801, lon: -122.405, sog: 11.8, cog: 247, heading: 249, status: 'Under way using engine', type: 'Cargo', callSign: 'WDC9182', destination: 'OAKLAND', drift: [-.00012, -.0005] },
  { mmsi: '368084090', name: 'POINT BONITA', lat: 37.842, lon: -122.469, sog: 0.2, cog: 12, heading: 18, status: 'Moored', type: 'Tug', callSign: 'WDL3451', destination: 'RICHMOND', drift: [.00001, .00001] },
  { mmsi: '477995616', name: 'EVER LOTUS', lat: 37.703, lon: -122.529, sog: 14.3, cog: 78, heading: 81, status: 'Under way using engine', type: 'Cargo', callSign: 'VRQK7', destination: 'SAN FRANCISCO', drift: [.00009, .00054] },
  { mmsi: '338297000', name: 'SEA CHANGE', lat: 37.785, lon: -122.333, sog: 6.1, cog: 192, heading: 189, status: 'Under way using engine', type: 'Passenger', callSign: 'WDF4983', destination: 'PIER 41', drift: [-.00038, -.00008] },
  { mmsi: '367060550', name: 'BAY VOYAGER', lat: 37.909, lon: -122.438, sog: 8.4, cog: 151, heading: 153, status: 'Under way using engine', type: 'Passenger', callSign: 'WDC2214', destination: 'SAN FRANCISCO', drift: [-.00034, .00017] },
  { mmsi: '366988860', name: 'GOLDEN GATE', lat: 37.827, lon: -122.357, sog: 0, cog: 0, heading: 340, status: 'At anchor', type: 'Cargo', callSign: 'WDB8210', destination: 'OAKLAND', drift: [0, 0] },
  { mmsi: '636021141', name: 'NORDIC BREEZE', lat: 37.645, lon: -122.589, sog: 12.6, cog: 41, heading: 43, status: 'Under way using engine', type: 'Tanker', callSign: 'D5NP8', destination: 'RICHMOND', drift: [.00034, .0003] },
  { mmsi: '367719770', name: 'RESOLVE PIONEER', lat: 37.754, lon: -122.623, sog: 4.7, cog: 98, heading: 101, status: 'Restricted maneuverability', type: 'Other', callSign: 'WDM2275', destination: 'ALAMEDA', drift: [-.00003, .00033] },
  { mmsi: '367153520', name: 'MARINER', lat: 37.937, lon: -122.412, sog: 7.2, cog: 223, heading: 225, status: 'Under way using engine', type: 'Pleasure craft', callSign: 'WDE5521', destination: 'SAUSALITO', drift: [-.00028, -.00028] }
];

const state = {
  vessels: new Map(),
  staticData: new Map(),
  markers: new Map(),
  trackLayers: new Map(),
  socket: null,
  demoTimer: null,
  reconnectTimer: null,
  connectionTimer: null,
  subscriptionTimer: null,
  reconnectAttempt: 0,
  liveConfig: null,
  intentionalDisconnect: false,
  selectedMmsi: null,
  filter: 'all',
  search: '',
  mode: 'demo',
  tracksEnabled: true
};

const els = Object.fromEntries([
  'vesselCount','allCount','vesselList','searchInput','selectionCard','connectionPill','connectionText',
  'connectButton','connectModal','connectForm','closeModal','toggleKey','apiKey','clearButton','fitButton',
  'locateButton','tracksButton','sidebar','openSidebar','closeSidebar','toastRegion'
].map(id => [id, document.getElementById(id)]));

const map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([37.795, -122.44], 11);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);
L.control.zoom({ position: 'topright' }).addTo(map);

function clean(value, fallback = '—') {
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) return fallback;
  return String(value).trim() || fallback;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return undefined;
  return String(value).trim() || undefined;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatAge(date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 8) return 'NOW';
  if (seconds < 60) return `${seconds} SEC`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} MIN`;
  return `${Math.floor(seconds / 3600)} HR`;
}

function formatEta(eta) {
  const monthValue = eta?.month ?? eta?.Month;
  const dayValue = eta?.day ?? eta?.Day;
  if (!monthValue || !dayValue) return '—';
  const month = String(monthValue).padStart(2, '0');
  const day = String(dayValue).padStart(2, '0');
  const hour = String(eta.hour ?? eta.Hour ?? 0).padStart(2, '0');
  const minute = String(eta.minute ?? eta.Minute ?? 0).padStart(2, '0');
  return `${month}/${day} ${hour}:${minute} UTC`;
}

function isStopped(vessel) {
  return Number(vessel.sog) < 0.5 || /anchor|moored|aground/i.test(vessel.status);
}

function isStale(vessel) {
  return Date.now() - vessel.updatedAt.getTime() > STALE_AFTER_MS;
}

function markerClass(vessel) {
  if (isStale(vessel)) return 'stale';
  return isStopped(vessel) ? 'stopped' : 'moving';
}

function shipIcon(vessel, selected = false) {
  const status = markerClass(vessel);
  return L.divIcon({
    className: `ship-marker${selected ? ' is-selected' : ''}`,
    html: `<div class="ship-marker-inner ${status}" style="--heading:${Number(vessel.heading) || Number(vessel.cog) || 0}deg">${SHIP_SVG}</div>`,
    iconSize: [31, 31],
    iconAnchor: [15.5, 15.5]
  });
}

function appendTrack(existingTrack, lat, lon, updatedAt) {
  const track = [...(existingTrack || [])];
  const last = track.at(-1);
  const moved = !last || Math.abs(last[0] - lat) + Math.abs(last[1] - lon) > 0.00008;
  if (moved) track.push([lat, lon, updatedAt.getTime()]);
  return track.slice(-MAX_TRACK_POINTS);
}

function upsertVessel(raw) {
  if (!raw.mmsi || !Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) return;
  const existing = state.vessels.get(raw.mmsi) || {};
  const enriched = state.staticData.get(raw.mmsi) || {};
  const updatedAt = validDate(raw.updatedAt || new Date());
  const vessel = {
    name: `VESSEL ${raw.mmsi}`,
    type: 'AIS contact',
    status: 'Status not available',
    sog: 0,
    cog: 0,
    heading: 0,
    ...existing,
    ...enriched,
    ...raw,
    updatedAt
  };
  vessel.track = appendTrack(existing.track, vessel.lat, vessel.lon, updatedAt);
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
  updateTrackLayer(vessel);
}

function updateTrackLayer(vessel) {
  let layer = state.trackLayers.get(vessel.mmsi);
  const positions = vessel.track.map(point => [point[0], point[1]]);
  if (!layer) {
    layer = L.polyline(positions, {
      color: isStopped(vessel) ? '#e6753b' : '#0c6f68',
      weight: 2,
      opacity: state.selectedMmsi === vessel.mmsi ? 0.85 : 0.34,
      dashArray: state.selectedMmsi === vessel.mmsi ? null : '3 6',
      interactive: false
    });
    state.trackLayers.set(vessel.mmsi, layer);
  } else {
    layer.setLatLngs(positions);
    layer.setStyle({
      color: isStopped(vessel) ? '#e6753b' : '#0c6f68',
      opacity: state.selectedMmsi === vessel.mmsi ? 0.85 : 0.34,
      dashArray: state.selectedMmsi === vessel.mmsi ? null : '3 6'
    });
  }
}

function mergeStaticData(mmsi, raw) {
  if (!mmsi) return;
  const previous = state.staticData.get(mmsi) || {};
  const merged = { ...previous, ...Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined && value !== null && value !== '')) };
  state.staticData.set(mmsi, merged);
  const vessel = state.vessels.get(mmsi);
  if (vessel) {
    state.vessels.set(mmsi, { ...vessel, ...merged });
    state.markers.get(mmsi)?.setIcon(shipIcon(state.vessels.get(mmsi), state.selectedMmsi === mmsi));
  }
}

function filteredVessels() {
  const query = state.search.toLowerCase();
  return [...state.vessels.values()]
    .filter(v => !query || v.name.toLowerCase().includes(query) || v.mmsi.includes(query) || String(v.callSign || '').toLowerCase().includes(query))
    .filter(v => state.filter === 'all' || (state.filter === 'stopped' ? isStopped(v) : !isStopped(v)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function inViewVessels(vessels = filteredVessels()) {
  const bounds = map.getBounds();
  return vessels.filter(v => bounds.contains([v.lat, v.lon]));
}

function updateVisibility(filtered = filteredVessels()) {
  const visibleIds = new Set(filtered.map(v => v.mmsi));
  state.markers.forEach((marker, mmsi) => {
    if (visibleIds.has(mmsi) && !map.hasLayer(marker)) marker.addTo(map);
    if (!visibleIds.has(mmsi) && map.hasLayer(marker)) marker.remove();
  });
  state.trackLayers.forEach((layer, mmsi) => {
    const shouldShow = state.tracksEnabled && visibleIds.has(mmsi) && (state.vessels.get(mmsi)?.track.length || 0) > 1;
    if (shouldShow && !map.hasLayer(layer)) layer.addTo(map);
    if (!shouldShow && map.hasLayer(layer)) layer.remove();
  });
}

function renderList() {
  const filtered = filteredVessels();
  els.vesselCount.textContent = inViewVessels(filtered).length;
  els.allCount.textContent = state.vessels.size;
  if (!filtered.length) {
    els.vesselList.innerHTML = '<div class="empty-state">No vessels match this view.<br />Try another search or filter.</div>';
  } else {
    els.vesselList.innerHTML = filtered.map(v => `
      <button class="vessel-row ${state.selectedMmsi === v.mmsi ? 'is-active' : ''}" data-mmsi="${v.mmsi}" type="button">
        <span class="vessel-icon ${isStopped(v) ? 'stopped' : ''}" style="--heading:${Number(v.heading) || Number(v.cog) || 0}deg">${SHIP_SVG}</span>
        <span class="vessel-main"><span class="vessel-name">${escapeHtml(v.name)}</span><span class="vessel-meta">MMSI ${v.mmsi} · ${escapeHtml(v.type)}</span></span>
        <span class="vessel-report"><strong>${formatAge(v.updatedAt)}</strong><span>${Number(v.sog).toFixed(1)} KN</span></span>
      </button>`).join('');
  }
  updateVisibility(filtered);
  if (state.selectedMmsi) renderSelection();
}

function renderSelection() {
  const v = state.vessels.get(state.selectedMmsi);
  if (!v) {
    els.selectionCard.classList.add('is-hidden');
    return;
  }
  const voyage = v.destination && v.destination !== '—' ? escapeHtml(v.destination) : 'Destination unavailable';
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
    <div class="voyage-line"><span><small>DESTINATION</small><strong>${voyage}</strong></span><span><small>CALL SIGN</small><strong>${escapeHtml(v.callSign || '—')}</strong></span><span><small>ETA</small><strong>${formatEta(v.eta)}</strong></span></div>
    <div class="position-line"><span>${escapeHtml(v.status)}</span><span>${v.lat.toFixed(4)}, ${v.lon.toFixed(4)}</span></div>`;
  els.selectionCard.classList.remove('is-hidden');
  els.selectionCard.querySelector('.close-card').addEventListener('click', clearSelection);
}

function selectVessel(mmsi, fly = true) {
  if (!state.vessels.has(mmsi)) return;
  const oldMmsi = state.selectedMmsi;
  state.selectedMmsi = mmsi;
  [oldMmsi, mmsi].filter(Boolean).forEach(id => {
    const vessel = state.vessels.get(id);
    if (!vessel) return;
    state.markers.get(id)?.setIcon(shipIcon(vessel, id === mmsi));
    updateTrackLayer(vessel);
  });
  const vessel = state.vessels.get(mmsi);
  if (fly) map.flyTo([vessel.lat, vessel.lon], Math.max(map.getZoom(), 13), { duration: .6 });
  renderList();
  els.sidebar.classList.remove('is-open');
}

function clearSelection() {
  const oldMmsi = state.selectedMmsi;
  state.selectedMmsi = null;
  if (oldMmsi && state.vessels.has(oldMmsi)) {
    const vessel = state.vessels.get(oldMmsi);
    state.markers.get(oldMmsi)?.setIcon(shipIcon(vessel, false));
    updateTrackLayer(vessel);
  }
  els.selectionCard.classList.add('is-hidden');
  renderList();
}

function escapeHtml(value) {
  const node = document.createElement('span');
  node.textContent = clean(value);
  return node.innerHTML;
}

function removeVessel(mmsi) {
  state.markers.get(mmsi)?.remove();
  state.trackLayers.get(mmsi)?.remove();
  state.markers.delete(mmsi);
  state.trackLayers.delete(mmsi);
  state.vessels.delete(mmsi);
  state.staticData.delete(mmsi);
  if (state.selectedMmsi === mmsi) {
    state.selectedMmsi = null;
    els.selectionCard.classList.add('is-hidden');
  }
}

function clearVessels() {
  [...state.vessels.keys()].forEach(removeVessel);
  state.staticData.clear();
  renderList();
}

function clearTrackHistory() {
  state.vessels.forEach(vessel => {
    vessel.track = [[vessel.lat, vessel.lon, vessel.updatedAt.getTime()]];
    updateTrackLayer(vessel);
  });
  updateVisibility();
}

function setConnection(mode, text, activeSession = Boolean(state.liveConfig)) {
  state.mode = mode;
  els.connectionPill.className = `connection-pill is-${mode}`;
  els.connectionText.textContent = text;
  els.connectButton.lastChild.textContent = activeSession ? ' Disconnect' : ' Connect live';
  els.connectButton.dataset.mobileLabel = activeSession ? 'DISCONNECT' : 'LIVE';
}

function startDemo() {
  disconnectLive(true);
  clearInterval(state.demoTimer);
  clearVessels();
  setConnection('demo', 'Demo feed', false);
  DEMO_SHIPS.forEach((ship, index) => upsertVessel({ ...ship, updatedAt: new Date(Date.now() - index * 7000) }));
  renderList();
  state.demoTimer = setInterval(() => {
    state.vessels.forEach(vessel => {
      const source = DEMO_SHIPS.find(ship => ship.mmsi === vessel.mmsi);
      if (!source) return;
      const jitter = () => (Math.random() - .5) * .00004;
      upsertVessel({
        ...vessel,
        lat: vessel.lat + source.drift[0] + jitter(),
        lon: vessel.lon + source.drift[1] + jitter(),
        updatedAt: new Date()
      });
    });
    renderList();
  }, 4000);
}

function disconnectLive(clearConfig = true) {
  state.intentionalDisconnect = true;
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.connectionTimer);
  clearTimeout(state.subscriptionTimer);
  state.reconnectTimer = null;
  state.connectionTimer = null;
  state.subscriptionTimer = null;
  if (state.socket) {
    state.socket.onclose = null;
    state.socket.close(1000, 'Client disconnect');
    state.socket = null;
  }
  if (clearConfig) state.liveConfig = null;
  state.reconnectAttempt = 0;
}

function subscriptionPayload() {
  const world = state.liveConfig.area === 'world';
  const bounds = map.getBounds();
  return {
    APIKey: state.liveConfig.apiKey,
    BoundingBoxes: world
      ? [[[-90, -180], [90, 180]]]
      : [[[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]]],
    FilterMessageTypes: ['PositionReport', 'ShipStaticData', 'StaticDataReport']
  };
}

function sendSubscription() {
  if (!state.liveConfig || state.socket?.readyState !== WebSocket.OPEN) return;
  state.socket.send(JSON.stringify(subscriptionPayload()));
}

function scheduleSubscriptionUpdate() {
  renderList();
  if (!state.liveConfig || state.liveConfig.area === 'world' || state.socket?.readyState !== WebSocket.OPEN) return;
  clearTimeout(state.subscriptionTimer);
  state.subscriptionTimer = setTimeout(() => {
    sendSubscription();
    setConnection('live', 'Live · this view', true);
  }, 700);
}

function connectLive(apiKey, area) {
  clearInterval(state.demoTimer);
  state.demoTimer = null;
  disconnectLive(false);
  clearVessels();
  state.liveConfig = { apiKey, area };
  state.reconnectAttempt = 0;
  openLiveSocket(false);
}

function openLiveSocket(isReconnect) {
  if (!state.liveConfig) return;
  state.intentionalDisconnect = false;
  setConnection(isReconnect ? 'reconnecting' : 'connecting', isReconnect ? `Retry ${state.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS}` : 'Connecting…', true);
  const socket = new WebSocket(SOCKET_URL);
  state.socket = socket;
  state.connectionTimer = setTimeout(() => {
    if (socket.readyState !== WebSocket.OPEN) socket.close();
  }, 10000);

  socket.onopen = () => {
    if (state.socket !== socket) return;
    clearTimeout(state.connectionTimer);
    state.reconnectAttempt = 0;
    sendSubscription();
    setConnection('live', state.liveConfig.area === 'world' ? 'Live · worldwide' : 'Live · this view', true);
    els.connectModal.classList.add('is-hidden');
    els.apiKey.value = '';
    showToast(isReconnect ? 'Live AIS connection restored.' : 'Live AIS connection established.');
  };

  socket.onmessage = event => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.error) {
        const message = clean(payload.error, 'AISStream rejected the subscription.');
        showToast(message, true);
        state.intentionalDisconnect = true;
        state.liveConfig = null;
        socket.close();
        setConnection('error', 'Feed rejected', false);
        return;
      }
      handleAisMessage(payload);
    } catch (error) {
      showToast(error.message || 'Could not read an AIS report.', true);
    }
  };

  socket.onerror = () => {
    if (state.socket === socket) setConnection('reconnecting', 'Connection interrupted', true);
  };

  socket.onclose = event => {
    if (state.socket !== socket) return;
    state.socket = null;
    clearTimeout(state.connectionTimer);
    if (state.intentionalDisconnect || !state.liveConfig || event.code === 1000) return;
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  state.reconnectAttempt += 1;
  if (state.reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
    state.liveConfig = null;
    setConnection('error', 'Feed unavailable', false);
    showToast('The live feed could not be restored. Your existing contacts remain on the map.', true);
    return;
  }
  const baseDelay = Math.min(1000 * (2 ** (state.reconnectAttempt - 1)), 30000);
  const delay = baseDelay + Math.round(Math.random() * 600);
  setConnection('reconnecting', `Retrying in ${Math.ceil(delay / 1000)}s`, true);
  state.reconnectTimer = setTimeout(() => openLiveSocket(true), delay);
}

function handleAisMessage(payload) {
  const meta = payload.MetaData || {};
  const mmsi = String(meta.MMSI ?? payload.Message?.PositionReport?.UserID ?? '');
  const position = payload.Message?.PositionReport;
  if (position) {
    upsertVessel({
      mmsi,
      name: clean(meta.ShipName, `VESSEL ${mmsi}`),
      lat: Number(meta.latitude ?? position.Latitude),
      lon: Number(meta.longitude ?? position.Longitude),
      sog: Number(position.Sog ?? 0),
      cog: Number(position.Cog ?? 0),
      heading: Number(position.TrueHeading ?? position.Cog ?? 0),
      status: navStatus(position.NavigationalStatus),
      updatedAt: meta.time_utc ? validDate(meta.time_utc) : new Date()
    });
    renderList();
    return;
  }

  const shipData = payload.Message?.ShipStaticData;
  if (shipData) {
    mergeStaticData(mmsi, parseShipStaticData(shipData));
    renderList();
    return;
  }

  const classBData = payload.Message?.StaticDataReport;
  if (classBData) {
    mergeStaticData(mmsi, parseClassBStaticData(classBData));
    renderList();
  }
}

function parseShipStaticData(data) {
  return {
    name: optionalText(data.Name),
    callSign: optionalText(data.CallSign),
    imo: data.ImoNumber || data.IMO,
    type: vesselType(data.Type),
    destination: optionalText(data.Destination),
    eta: data.Eta || data.ETA,
    draught: data.MaximumStaticDraught ?? data.Draught,
    dimensions: data.Dimension
  };
}

function parseClassBStaticData(data) {
  const reportA = data.ReportA || {};
  const reportB = data.ReportB || {};
  return {
    name: optionalText(reportA.Name),
    callSign: optionalText(reportB.CallSign),
    type: reportB.ShipType === undefined ? undefined : vesselType(reportB.ShipType),
    dimensions: reportB.Dimension
  };
}

function vesselType(code) {
  const type = Number(code);
  if (!Number.isFinite(type)) return undefined;
  if (type >= 20 && type < 30) return 'Wing in ground';
  if (type === 30) return 'Fishing';
  if (type === 31 || type === 32) return 'Tug';
  if (type === 33) return 'Dredger';
  if (type === 34) return 'Diving vessel';
  if (type === 35) return 'Military';
  if (type === 36 || type === 37) return 'Sailing vessel';
  if (type >= 40 && type < 50) return 'High-speed craft';
  if (type === 50) return 'Pilot vessel';
  if (type === 51) return 'Search and rescue';
  if (type === 52) return 'Tug';
  if (type === 53) return 'Port tender';
  if (type === 55) return 'Law enforcement';
  if (type >= 60 && type < 70) return 'Passenger';
  if (type >= 70 && type < 80) return 'Cargo';
  if (type >= 80 && type < 90) return 'Tanker';
  return 'Other';
}

function navStatus(code) {
  const statuses = ['Under way using engine','At anchor','Not under command','Restricted maneuverability','Constrained by draught','Moored','Aground','Engaged in fishing','Under way sailing'];
  return statuses[Number(code)] || 'Status not available';
}

function fitVessels() {
  const vessels = filteredVessels();
  if (!vessels.length) return showToast('No vessels to fit on the map.');
  map.fitBounds(L.latLngBounds(vessels.map(v => [v.lat, v.lon])), { padding: [55, 55], maxZoom: 13 });
}

function runHousekeeping() {
  const now = Date.now();
  state.vessels.forEach((vessel, mmsi) => {
    if (state.mode !== 'demo' && now - vessel.updatedAt.getTime() > EXPIRE_AFTER_MS) {
      removeVessel(mmsi);
      return;
    }
    state.markers.get(mmsi)?.setIcon(shipIcon(vessel, state.selectedMmsi === mmsi));
  });
  renderList();
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
els.searchInput.addEventListener('input', event => {
  state.search = event.target.value.trim();
  renderList();
});
document.querySelectorAll('.filter-chip').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.filter-chip').forEach(item => item.classList.remove('is-active'));
  button.classList.add('is-active');
  state.filter = button.dataset.filter;
  renderList();
}));
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    els.searchInput.focus();
  }
  if (event.key === 'Escape') {
    els.connectModal.classList.add('is-hidden');
    clearSelection();
  }
});
els.connectButton.addEventListener('click', () => {
  if (state.liveConfig) {
    startDemo();
    showToast('Live feed disconnected.');
  } else {
    els.connectModal.classList.remove('is-hidden');
    setTimeout(() => els.apiKey.focus(), 100);
  }
});
els.closeModal.addEventListener('click', () => els.connectModal.classList.add('is-hidden'));
els.connectModal.addEventListener('click', event => {
  if (event.target === els.connectModal) els.connectModal.classList.add('is-hidden');
});
els.toggleKey.addEventListener('click', () => {
  const show = els.apiKey.type === 'password';
  els.apiKey.type = show ? 'text' : 'password';
  els.toggleKey.textContent = show ? 'Hide' : 'Show';
});
els.connectForm.addEventListener('submit', event => {
  event.preventDefault();
  connectLive(els.apiKey.value.trim(), new FormData(event.currentTarget).get('area'));
});
els.clearButton.addEventListener('click', () => {
  clearTrackHistory();
  showToast('Track history cleared.');
});
els.tracksButton.addEventListener('click', () => {
  state.tracksEnabled = !state.tracksEnabled;
  els.tracksButton.classList.toggle('is-active', state.tracksEnabled);
  els.tracksButton.setAttribute('aria-pressed', String(state.tracksEnabled));
  updateVisibility();
  showToast(`Track trails ${state.tracksEnabled ? 'shown' : 'hidden'}.`);
});
els.fitButton.addEventListener('click', fitVessels);
els.locateButton.addEventListener('click', () => {
  if (!navigator.geolocation) return showToast('Location is not available in this browser.', true);
  navigator.geolocation.getCurrentPosition(
    position => map.flyTo([position.coords.latitude, position.coords.longitude], 11),
    () => showToast('Location access was not available.', true),
    { enableHighAccuracy: false, timeout: 8000 }
  );
});
els.openSidebar.addEventListener('click', () => els.sidebar.classList.add('is-open'));
els.closeSidebar.addEventListener('click', () => els.sidebar.classList.remove('is-open'));
map.on('click', clearSelection);
map.on('moveend', scheduleSubscriptionUpdate);
window.addEventListener('beforeunload', () => disconnectLive(true));

els.tracksButton.innerHTML = TRACK_SVG;
startDemo();
setTimeout(() => {
  map.invalidateSize();
  renderList();
}, 150);
setInterval(runHousekeeping, 15000);

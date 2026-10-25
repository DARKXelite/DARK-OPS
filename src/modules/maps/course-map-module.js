/** Leaflet course boundary and live equipment radar module. */
export function createCourseMapModule(deps) {
  const { ATTR, CONFIG, S, TILE, ZCOL, addDoc, ago, collection, db, esc, fld, fmt, liveList, openForm, pad, setHTML, toast } = deps;
let zoneMap = null, radarMap = null, drawn = null, drawCoords = [], zoneLayers = { zone: null, radar: null }, markers = {}, radarFitted = false;
function courseZone() {
  return S.zones.find(z => (z.zoneType || '').toLowerCase() === 'course')
    || S.zones.find(z => /course|boundary|property/i.test(z.zoneName || ''));
}
function fitToCourse(map) {
  if (!map) return;
  const cz = courseZone();
  if (cz && cz.coordinates && cz.coordinates.length >= 3) {
    const latlngs = cz.coordinates.map(q => [Number(q.lat), Number(q.lng)]).filter(q => !isNaN(q[0]));
    if (latlngs.length >= 3) {
      try { map.fitBounds(L.latLngBounds(latlngs).pad(0.08), { maxZoom: 18 }); return; } catch (e) {}
    }
  }
  // fallback: current location if available
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 16);
    }, () => {}, { enableHighAccuracy: true, timeout: 5000 });
  }
}
function addLocateControl(map) {
  if (!map || map._locateBtn) return;
  const ctl = L.control({ position: 'bottomright' });
  ctl.onAdd = function () {
    const d = L.DomUtil.create('div', 'leaflet-bar');
    const a = L.DomUtil.create('a', '', d);
    a.href = '#'; a.title = 'My location'; a.innerHTML = '?'; a.style.cssText = 'font-size:18px;font-weight:700;color:#E5C794';
    L.DomEvent.on(a, 'click', L.DomEvent.stop).on(a, 'click', () => {
      if (!navigator.geolocation) return toast('Location not available', 'err');
      navigator.geolocation.getCurrentPosition(pos => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        map.setView(ll, Math.max(map.getZoom(), 17));
        if (map._meMarker) map._meMarker.setLatLng(ll);
        else map._meMarker = L.circleMarker(ll, { radius: 8, color: '#E5C794', fillColor: '#E5C794', fillOpacity: 0.9, weight: 2 }).addTo(map);
      }, () => toast('Could not get current location', 'err'), { enableHighAccuracy: true, timeout: 8000 });
    });
    return d;
  };
  ctl.addTo(map);
  map._locateBtn = true;
}

function initZoneMap() {
  if (zoneMap) { zoneMap.invalidateSize(); fitToCourse(zoneMap); return; }
  zoneMap = L.map('zoneMap', { zoomControl: false, drawControl: false }).setView([CONFIG.LAT, CONFIG.LNG], 16);
  L.control.zoom({ position: 'bottomright' }).addTo(zoneMap);
  L.tileLayer(TILE, { maxZoom: 19, attribution: ATTR }).addTo(zoneMap);
  zoneLayers.zone = L.layerGroup().addTo(zoneMap);
  drawn = new L.FeatureGroup().addTo(zoneMap);
  addLocateControl(zoneMap);
  const drawControl = new L.Control.Draw({
    position: 'topleft',
    edit: { featureGroup: drawn, remove: true },
    draw: {
      polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#E5C794', weight: 2, fillOpacity: 0.2 } },
      polyline: false, rectangle: false, circle: false, marker: false, circlemarker: false
    }
  });
  zoneMap.addControl(drawControl);
  zoneMap.on(L.Draw.Event.CREATED, ev => {
    drawn.clearLayers();
    drawn.addLayer(ev.layer);
    const latlngs = ev.layer.getLatLngs();
    const ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
    drawCoords = ring.map(p => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }));
    zoneForm();
  });
  zoneMap.on(L.Draw.Event.DELETED, () => { drawCoords = []; drawn.clearLayers(); });
  drawZones();
  fitToCourse(zoneMap);
}
function initRadarMap() {
  if (radarMap) { radarMap.invalidateSize(); fitToCourse(radarMap); return; }
  radarMap = L.map('radarMap', { zoomControl: false }).setView([CONFIG.LAT, CONFIG.LNG], 16);
  L.control.zoom({ position: 'bottomright' }).addTo(radarMap);
  L.tileLayer(TILE, { maxZoom: 19, attribution: ATTR }).addTo(radarMap);
  zoneLayers.radar = L.layerGroup().addTo(radarMap);
  addLocateControl(radarMap);
  drawZones(); updateRadar();
  fitToCourse(radarMap);
}
function drawZones() {
  [['zone', zoneMap, true], ['radar', radarMap, false]].forEach(([k, map, showLabel]) => {
    if (!map || !zoneLayers[k]) return;
    zoneLayers[k].clearLayers();
    S.zones.forEach(z => {
      if (!z.coordinates || !z.coordinates.length) return;
      const c = ZCOL[z.zoneType] || '#E5C794';
      const latlngs = z.coordinates.map(q => [Number(q.lat), Number(q.lng)]).filter(q => !isNaN(q[0]) && !isNaN(q[1]));
      if (latlngs.length < 3) return;
      const p = L.polygon(latlngs, {
        color: c,
        weight: showLabel ? 2.5 : 1.25,
        fillColor: c,
        fillOpacity: showLabel ? 0.22 : 0.08,
        dashArray: showLabel ? null : '4 4'
      }).addTo(zoneLayers[k]);
      const title = z.zoneName || 'Zone';
      const subtitle = z.zoneType || '';
      p.bindPopup(`<b>${esc(title)}</b>${subtitle ? '<br>' + esc(subtitle) : ''}`);
      if (showLabel) {
        p.bindTooltip(
          `<span style="font-weight:800">${esc(title)}</span>${subtitle ? ` <span style="opacity:.8;font-weight:600">· ${esc(subtitle)}</span>` : ''}`,
          { permanent: true, direction: 'center', className: 'place-label', opacity: 1 }
        );
      }
    });
  });
}
function updateRadar() {
  if (!radarMap) return;
  const ll = liveList(), seen = new Set();
  ll.forEach(l => {
    seen.add(l.id); const pos = [l.lat, l.lng], cls = l._stale ? 'pin stale' : 'pin';
    const icon = L.divIcon({ className: '', html: `<div class="${cls}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22] });
    const label = esc(l._name);
    const tip = `<b>${esc(l._name)}</b><br>${esc(l.operatorName || '—')}<br>${fmt(l.speed || 0)} km/h · ${ago(l._ts)}`;
    if (markers[l.id]) {
      markers[l.id].setLatLng(pos).setIcon(icon);
      markers[l.id].setTooltipContent(label);
      markers[l.id].setPopupContent(tip);
    } else {
      markers[l.id] = L.marker(pos, { icon }).addTo(radarMap)
        .bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -16], className: 'zlabel', opacity: 0.95 })
        .bindPopup(tip);
    }
  });
  Object.keys(markers).forEach(id => { if (!seen.has(id)) { radarMap.removeLayer(markers[id]); delete markers[id]; } });
  if (!radarFitted && ll.length) { radarMap.fitBounds(L.latLngBounds(ll.map(l => [l.lat, l.lng])).pad(.4), { maxZoom: 17 }); radarFitted = true; }
}
function renderRadarPanel() {
  const ll = liveList(), n = ll.filter(l => !l._stale).length;
  $('#radarCount').textContent = `${n} live`;
  const hudLive = $('#hudLive'); if (hudLive) hudLive.textContent = n;
  document.body.classList.toggle('has-live', n > 0);
  setHTML($('#radarList'), ll.length ? ll.map(l => `<div class="list-row" style="cursor:default"><div style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l._name)}</b><div class="muted sm" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.operatorName || '—')} · ${fmt(l.speed || 0)} km/h</div></div><div class="right" style="flex:none"><span class="badge ${l._stale ? 'mute' : 'gold live'}">${l._stale ? 'Stale' : 'Live'}</span><div class="muted sm">${ago(l._ts)}</div></div></div>`).join('') : '<div class="empty">No machines live</div>');
  updateRadar();
}
function renderZonePanel() {
  const hz = $('#hudZones'); if (hz) hz.textContent = `${S.zones.length} ZONES`;
  const order = { Course: 0, Green: 1, Fairway: 2, Rough: 3, Tee: 4, Other: 5 };
  const zones = [...S.zones].sort((a, b) => (order[a.zoneType] ?? 9) - (order[b.zoneType] ?? 9) || (a.zoneName || '').localeCompare(b.zoneName || ''));
  setHTML($('#zoneList'), zones.length ? zones.map(z => `<div class="list-row"><div><b>${esc(z.zoneName || 'Zone')}</b><div class="muted sm"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ZCOL[z.zoneType] || '#E5C794'};margin-right:5px"></span>${esc(z.zoneType || '-')}</div></div><button class="btn btn-danger btn-sm" data-act="del" data-col="zones" data-id="${esc(z.id)}" data-label="${esc(z.zoneName || 'this zone')}"><span class="material-symbols-rounded">delete</span></button></div>`).join('') : '<div class="empty">Draw Course boundary first</div>');
}
function zoneForm() {
  if (!drawCoords || drawCoords.length < 3) {
    toast('Draw a complete polygon first (at least 3 points)', 'err');
    return;
  }
  openForm({
    title: 'Save zone',
    html: fld('Area name', '<input id="zName" placeholder="e.g. Hole 7 Green" autocomplete="off">') +
      fld('Type', '<select id="zType"><option>Course</option><option>Green</option><option>Fairway</option><option>Rough</option><option>Tee</option><option>Other</option></select>'),
    submit: 'Save zone',
    onSubmit: async () => {
      const name = ($('#zName')?.value || '').trim();
      if (!name) { toast('Area name is required', 'err'); return false; }
      if (!drawCoords || drawCoords.length < 3) { toast('Polygon is incomplete', 'err'); return false; }
      try {
        const zType = $('#zType').value;
        await addDoc(collection(db, CONFIG.COL.zones), {
          zoneName: name,
          zoneType: zType,
          coordinates: drawCoords
        });
        drawCoords = [];
        if (drawn) drawn.clearLayers();
        toast('Zone saved');
        // If course boundary, refit maps
        setTimeout(() => { fitToCourse(zoneMap); fitToCourse(radarMap); }, 400);
        return true;
      } catch (e) {
        console.error(e);
        toast('Could not save zone', 'err');
        return false;
      }
    }
  });
  setTimeout(() => $('#zName')?.focus(), 120);
}

/* ================= REGISTRY & INCIDENTS ================= */

function resizeMap(view) {
  const map = view === 'radar' ? radarMap : zoneMap;
  if (!map) return;
  map.invalidateSize();
  fitToCourse(map);
}

  return { courseZone, fitToCourse, addLocateControl, initZoneMap, initRadarMap, drawZones, updateRadar, renderRadarPanel, renderZonePanel, zoneForm, resizeMap };
}

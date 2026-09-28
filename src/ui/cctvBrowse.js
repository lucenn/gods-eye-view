export const DES_MOINES_CITY_ID = 'des-moines-iowa';
export const DES_MOINES_CENTER = Object.freeze({ lat: 41.5868, lon: -93.625 });

const fold = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function isVideoCamera(camera) {
  return ['hls', 'mp4', 'webm'].includes(
    String(camera?.feedType || '').toLowerCase(),
  );
}

export function normalizeCctvRoute(value) {
  const route = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
  if (!route) return '';
  const interstate = /^(?:INTERSTATE|I)[\s-]*(\d+[A-Z]?)$/.exec(route);
  if (interstate) return `I-${interstate[1]}`;
  const us = /^US[\s-]*(\d+[A-Z]?)$/.exec(route);
  if (us) return `US-${us[1]}`;
  const iowa = /^(?:IOWA|IA)[\s-]*(\d+[A-Z]?)$/.exec(route);
  if (iowa) return `IA-${iowa[1]}`;
  return route;
}

export function cctvCatalogCounts(cameras, cityId = DES_MOINES_CITY_ID) {
  const scoped = (Array.isArray(cameras) ? cameras : []).filter(
    (camera) => !cityId || camera?.cityId === cityId,
  );
  const video = scoped.filter(isVideoCamera).length;
  return { total: scoped.length, video, image: scoped.length - video };
}

export function cctvRoutes(cameras, cityId = DES_MOINES_CITY_ID) {
  return [
    ...new Set(
      (Array.isArray(cameras) ? cameras : [])
        .filter((camera) => !cityId || camera?.cityId === cityId)
        .map((camera) => normalizeCctvRoute(camera?.route))
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function filterCctvCameras(cameras, filters = {}) {
  const region = filters.region || 'all';
  const route = normalizeCctvRoute(filters.route);
  const feed = filters.feed || 'all';
  const query = fold(filters.query);
  const source = Array.isArray(cameras) ? cameras : [];
  const filtered = source.filter((camera) => {
    if (region === 'des-moines' && camera?.cityId !== DES_MOINES_CITY_ID)
      return false;
    if (route && route !== 'ALL' && normalizeCctvRoute(camera?.route) !== route)
      return false;
    if (feed === 'video' && !isVideoCamera(camera)) return false;
    if (feed === 'image' && isVideoCamera(camera)) return false;
    if (!query) return true;
    return fold(
      [
        camera?.name,
        camera?.route,
        camera?.code,
        camera?.city,
        camera?.provider,
      ]
        .filter(Boolean)
        .join(' '),
    ).includes(query);
  });
  if (
    region === 'all' &&
    (!route || route === 'ALL') &&
    feed === 'all' &&
    !query
  )
    return filtered;
  return filtered.sort((a, b) => {
    const videoOrder = Number(isVideoCamera(b)) - Number(isVideoCamera(a));
    if (videoOrder) return videoOrder;
    const routeOrder = normalizeCctvRoute(a?.route).localeCompare(
      normalizeCctvRoute(b?.route),
      undefined,
      { numeric: true },
    );
    return (
      routeOrder || String(a?.name || '').localeCompare(String(b?.name || ''))
    );
  });
}

function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function selectDesMoinesQuickStart(cameras, center = DES_MOINES_CENTER) {
  const iowa = (Array.isArray(cameras) ? cameras : []).filter(
    (camera) =>
      camera?.cityId === DES_MOINES_CITY_ID && camera?.provider === 'Iowa DOT',
  );
  const preferred = iowa.filter(isVideoCamera);
  const candidates = preferred.length ? preferred : iowa;
  return (
    candidates
      .filter(
        (camera) =>
          Number.isFinite(camera?.lat) && Number.isFinite(camera?.lon),
      )
      .map((camera) => ({ camera, distance: haversineKm(center, camera) }))
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          String(a.camera.name || '').localeCompare(
            String(b.camera.name || ''),
          ),
      )[0]?.camera || null
  );
}

export function cctvOptionLabel(camera, { includeCity = false } = {}) {
  const tag = isVideoCamera(camera) ? 'VIDEO' : 'IMG';
  const route = normalizeCctvRoute(camera?.route);
  const name = String(camera?.name || camera?.id || 'Camera').trim();
  let label =
    route && !fold(name).startsWith(fold(route)) ? `${route} · ${name}` : name;
  if (includeCity && camera?.city) label = `${camera.city} · ${label}`;
  return `[${tag}] ${label}`;
}

export function cctvFeedStatus(
  camera,
  { playbackState, imageReady = false, imageError = false } = {},
) {
  if (!camera) return { label: 'NO CAMERA', tone: 'idle' };
  if (!isVideoCamera(camera))
    return imageError && !imageReady
      ? { label: 'DEGRADED', tone: 'degraded' }
      : { label: 'LIVE IMAGE', tone: 'image' };
  const state = playbackState || camera.playbackState || 'connecting';
  if (state === 'playing') return { label: 'LIVE VIDEO', tone: 'live' };
  if (state === 'fallback')
    return imageError && !imageReady
      ? { label: 'DEGRADED', tone: 'degraded' }
      : { label: 'IMAGE FALLBACK', tone: 'fallback' };
  if (state === 'stalled' || state === 'failed')
    return { label: 'STREAM DEGRADED', tone: 'degraded' };
  return { label: 'CONNECTING LIVE VIDEO…', tone: 'connecting' };
}

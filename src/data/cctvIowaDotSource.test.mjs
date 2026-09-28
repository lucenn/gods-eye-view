import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  iowaDotCameraId,
  iowaDotCameraToSource,
  loadIowaDotSourcesFromOpenData,
  normalizeIowaDotImageUrl,
  normalizeIowaDotVideoUrl,
} from '../../server/providers/cctv/sources.js';
import { IOWADOT_CCTV_URL } from '../../server/providers/cctv/constants.js';
import { createCctvCatalog } from '../../server/providers/cctv/catalog.js';

const camera = (overrides = {}) => ({
  COMMON_ID: 'DMTV114',
  device_id: 114,
  Desc_: 'I-35 @ Oralabor Rd',
  Route: 'I-35',
  ImageURL:
    'https://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/DMTV114.jpeg',
  VideoURL:
    'https://video4.iowadot.gov:8888/ankeny/dmtv114lb/playlist.m3u8',
  latitude: 41.702,
  longitude: -93.573,
  ...overrides,
});

test('an Iowa DOT row maps to a stable, geographically scoped image source', () => {
  const source = iowaDotCameraToSource(camera());
  assert.equal(source.id, 'iowadot-dmtv114');
  assert.equal(source.id, iowaDotCameraId(camera()));
  assert.equal(source.name, 'I-35 @ Oralabor Rd');
  assert.equal(source.cityId, 'des-moines-iowa');
  assert.equal(source.provider, 'Iowa DOT');
  assert.equal(source.headingConfidence, 'low');
  assert.equal(source.feedType, 'hls');
  assert.notEqual(source.url, source.snapshotUrl);
  assert.equal(source.sourceKind, 'iowadot-open-data');
});

test('distance and coordinate validation exclude invalid or out-of-area rows', () => {
  assert.ok(iowaDotCameraToSource(camera()));
  assert.equal(
    iowaDotCameraToSource(camera({ latitude: 41.6611, longitude: -91.5302 })),
    null,
  );
  for (const latitude of [null, '', 'not-a-number', 100]) {
    assert.equal(iowaDotCameraToSource(camera({ latitude })), null);
  }
  assert.equal(iowaDotCameraToSource(camera({ longitude: undefined })), null);
});

test('official fMP4 HLS is registered with its JPEG fallback', () => {
  const image = camera().ImageURL;
  const video = camera().VideoURL;
  assert.equal(normalizeIowaDotImageUrl(image), image);
  assert.equal(normalizeIowaDotVideoUrl(video), video);
  const source = iowaDotCameraToSource(camera());
  assert.equal(source.feedType, 'hls');
  assert.equal(source.url, video);
  assert.equal(source.snapshotUrl, image);

  for (const value of [
    'http://atmsqf.iowadot.gov/SNAPSHOTS/PUBLIC/DMTV114.jpeg',
    'https://atmsqf.iowadot.gov.evil.test/SNAPSHOTS/PUBLIC/x.jpeg',
    'file:///etc/passwd',
    'not a url',
  ]) {
    assert.equal(normalizeIowaDotImageUrl(value), null);
  }
  assert.equal(
    normalizeIowaDotVideoUrl(
      'https://evil.test:8888/ankeny/dmtv114lb/playlist.m3u8',
    ),
    null,
  );
  assert.equal(
    iowaDotCameraToSource(camera({ ImageURL: 'https://evil.test/x.jpg' })),
    null,
  );
});

test('image-only cameras remain usable and naming follows official fields', () => {
  const source = iowaDotCameraToSource(camera({ VideoURL: '' }));
  assert.equal(source.feedType, 'image');
  assert.equal(source.snapshotUrl, camera().ImageURL);
  assert.equal(
    iowaDotCameraToSource(camera({ Desc_: '', Route: 'I-235' })).name,
    'I-235 · DMTV114',
  );
});

test('the loader queries ArcGIS, deduplicates rows, and survives bad upstreams', async (t) => {
  t.mock.method(console, 'log', () => {});
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested.push(String(url));
    return Response.json({
      features: [
        { attributes: camera() },
        { attributes: camera({ Desc_: 'duplicate' }) },
      ],
    });
  });
  const sources = await loadIowaDotSourcesFromOpenData();
  assert.equal(sources.length, 1);
  const url = new URL(requested[0]);
  assert.equal(`${url.origin}${url.pathname}`, IOWADOT_CCTV_URL);
  assert.equal(url.searchParams.get('returnGeometry'), 'false');
  assert.match(url.searchParams.get('outFields'), /ImageURL/);

  t.mock.restoreAll();
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  assert.deepEqual(await loadIowaDotSourcesFromOpenData(), []);

  t.mock.restoreAll();
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  assert.deepEqual(await loadIowaDotSourcesFromOpenData(), []);

  t.mock.restoreAll();
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('timeout');
  });
  assert.deepEqual(await loadIowaDotSourcesFromOpenData(), []);
});

const runCatalog = async (t) => {
  const requested = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (url) => {
    const href = String(url);
    requested.push(href);
    if (href.startsWith(IOWADOT_CCTV_URL)) {
      return Response.json({ features: [{ attributes: camera() }] });
    }
    return Response.json([]);
  });
  const sources = await createCctvCatalog({ sourceRoot: '/nonexistent' })();
  return { requested, sources };
};

test('the Iowa DOT catalog lane is enabled by default and has a kill switch', async (t) => {
  const saved = { ...process.env };
  try {
    delete process.env.CCTV_SOURCES_FILE;
    delete process.env.CCTV_SOURCES_JSON;
    delete process.env.CCTV_IOWADOT_ENABLED;
    let result = await runCatalog(t);
    assert.ok(result.requested.some((url) => url.startsWith(IOWADOT_CCTV_URL)));
    assert.deepEqual(
      result.sources.filter((source) => source.cityId === 'des-moines-iowa').map((source) => source.id),
      ['iowadot-dmtv114'],
    );

    t.mock.restoreAll();
    process.env.CCTV_IOWADOT_ENABLED = '0';
    result = await runCatalog(t);
    assert.equal(
      result.requested.some((url) => url.startsWith(IOWADOT_CCTV_URL)),
      false,
    );
    assert.deepEqual(
      result.sources.filter((source) => source.cityId === 'des-moines-iowa'),
      [],
    );
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
});

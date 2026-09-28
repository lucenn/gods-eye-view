import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cctvCatalogCounts,
  cctvFeedStatus,
  cctvRoutes,
  filterCctvCameras,
  normalizeCctvRoute,
  selectDesMoinesQuickStart,
} from './cctvBrowse.js';

const cameras = [
  { id: 'near-image', name: 'I-235 @ 42nd St', code: '42ND', city: 'Des Moines Area', cityId: 'des-moines-iowa', provider: 'Iowa DOT', route: 'I 235', feedType: 'image', lat: 41.587, lon: -93.625 },
  { id: 'near-video', name: 'I-235 @ University Ave', code: 'UNIVERSITY', city: 'Des Moines Area', cityId: 'des-moines-iowa', provider: 'Iowa DOT', route: 'Interstate 235', feedType: 'hls', lat: 41.59, lon: -93.63 },
  { id: 'i80-video', name: 'I-80 @ Jordan Creek', code: 'JORDAN', city: 'Des Moines Area', cityId: 'des-moines-iowa', provider: 'Iowa DOT', route: 'I-80', feedType: 'hls', lat: 41.6, lon: -93.7 },
  { id: 'austin', name: '5th / Congress', city: 'Austin', cityId: 'austin', provider: 'Austin', route: '', feedType: 'image', lat: 30.2, lon: -97.7 },
];

test('region, route, feed and search filters compose', () => {
  assert.deepEqual(filterCctvCameras(cameras, { region: 'des-moines' }).map((c) => c.id).sort(), ['i80-video', 'near-image', 'near-video']);
  assert.deepEqual(filterCctvCameras(cameras, { region: 'des-moines', route: 'I-235' }).map((c) => c.id).sort(), ['near-image', 'near-video']);
  assert.deepEqual(filterCctvCameras(cameras, { region: 'des-moines', feed: 'video' }).map((c) => c.id).sort(), ['i80-video', 'near-video']);
  assert.deepEqual(filterCctvCameras(cameras, { region: 'des-moines', feed: 'image' }).map((c) => c.id), ['near-image']);
  assert.deepEqual(filterCctvCameras(cameras, { region: 'des-moines', route: 'I-235', feed: 'image', query: '42' }).map((c) => c.id), ['near-image']);
  assert.deepEqual(filterCctvCameras(cameras, { query: 'UNIVERSITY' }).map((c) => c.id), ['near-video']);
  assert.deepEqual(filterCctvCameras(cameras, { query: 'i-80' }).map((c) => c.id), ['i80-video']);
});

test('counts and routes derive from current Des Moines catalog metadata', () => {
  assert.deepEqual(cctvCatalogCounts(cameras), { total: 3, video: 2, image: 1 });
  assert.deepEqual(cctvRoutes(cameras), ['I-80', 'I-235']);
});

test('route normalization is conservative and consistent', () => {
  assert.equal(normalizeCctvRoute('I 235'), 'I-235');
  assert.equal(normalizeCctvRoute('Interstate 235'), 'I-235');
  assert.equal(normalizeCctvRoute('i-235'), 'I-235');
  assert.equal(normalizeCctvRoute('US 65'), 'US-65');
});

test('quick start prefers the nearest video and falls back to an image', () => {
  assert.equal(selectDesMoinesQuickStart(cameras).id, 'near-video');
  assert.equal(selectDesMoinesQuickStart(cameras.filter((c) => c.feedType !== 'hls')).id, 'near-image');
});

test('feed labels distinguish startup, playback, fallback and image-only', () => {
  assert.equal(cctvFeedStatus(cameras[1], { playbackState: 'connecting' }).label, 'CONNECTING LIVE VIDEO…');
  assert.equal(cctvFeedStatus(cameras[1], { playbackState: 'playing' }).label, 'LIVE VIDEO');
  assert.equal(cctvFeedStatus(cameras[1], { playbackState: 'fallback', imageReady: true }).label, 'IMAGE FALLBACK');
  assert.equal(cctvFeedStatus(cameras[0], { imageReady: true }).label, 'LIVE IMAGE');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  candidateCycleCameraId,
  nearestCandidateCameraId,
} from './navigation.js';

const records = [
  { camera: { id: 'a', lat: 0, lon: 0 } },
  { camera: { id: 'b', lat: 10, lon: 10 } },
  { camera: { id: 'c', lat: 1, lon: 1 } },
];
const distance = (a, b, c, d) => Math.hypot(a - c, b - d);

test('candidate cycling remains inside filters and wraps', () => {
  assert.equal(candidateCycleCameraId(records, 'a', 1, ['a', 'c']), 'c');
  assert.equal(candidateCycleCameraId(records, 'c', 1, ['a', 'c']), 'a');
  assert.equal(candidateCycleCameraId(records, 'a', -1, ['a', 'c']), 'c');
  assert.equal(candidateCycleCameraId(records, 'b', 1, ['a', 'c']), 'a');
});

test('unscoped cycling preserves full-catalog behavior', () => {
  assert.equal(candidateCycleCameraId(records, 'a', 1), 'b');
  assert.equal(candidateCycleCameraId(records, 'c', 1), 'a');
});

test('candidate nearest ignores cameras outside the supplied IDs', () => {
  assert.equal(nearestCandidateCameraId(records, 0, 0, distance), 'a');
  assert.equal(
    nearestCandidateCameraId(records, 0, 0, distance, ['b', 'c']),
    'c',
  );
  assert.equal(nearestCandidateCameraId(records, 0, 0, distance, []), null);
});

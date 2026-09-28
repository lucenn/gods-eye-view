import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHlsPuller,
  fetchHlsBytes,
  hlsResourceContentType,
  parseHlsMedia,
  HLS_LIMITS,
} from '../../server/providers/cctv/stream.js';
const playlist =
  '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:12\n#EXTINF:2,\na.ts\n#EXTINF:2,\nb.ts\n#EXTINF:2,\nc.ts\n';
const base = 'https://camera.example/live/list.m3u8';
const fmp4Playlist =
  '#EXTM3U\n#EXT-X-VERSION:10\n#EXT-X-MEDIA-SEQUENCE:20\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\na.mp4\n#EXTINF:2,\nb.mp4\n#EXTINF:2,\nc.mp4\n';

test('playlist parser uses sequence, refuses escaping and unsupported references', () => {
  assert.deepEqual(
    parseHlsMedia(playlist, base).segments.map((s) => s.seq),
    [12, 13, 14],
  );
  for (const bad of [
    playlist.replace('a.ts', 'https://evil.example/a.ts'),
    playlist.replace('a.ts', '//evil.example/a.ts'),
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128\n' + playlist,
    playlist.replace('12', '-1'),
    playlist.replace('2,', 'Infinity,'),
  ])
    assert.throws(() => parseHlsMedia(bad, base));
});

test('fMP4 parser accepts one same-origin init and clear MP4 fragments', () => {
  const parsed = parseHlsMedia(fmp4Playlist, base);
  assert.equal(parsed.transport, 'fmp4');
  assert.equal(parsed.version, 10);
  assert.equal(parsed.initUri, 'https://camera.example/live/init.mp4');
  assert.deepEqual(
    parsed.segments.map((segment) => [segment.seq, segment.uri]),
    [
      [20, 'https://camera.example/live/a.mp4'],
      [21, 'https://camera.example/live/b.mp4'],
      [22, 'https://camera.example/live/c.mp4'],
    ],
  );
  assert.equal(
    parseHlsMedia(
      fmp4Playlist.replace(
        'URI="init.mp4"',
        'URI="https://camera.example/live/init.mp4"',
      ),
      base,
    ).initUri,
    'https://camera.example/live/init.mp4',
  );
});

test('fMP4 parser rejects escaping, encryption, byte ranges and mixed containers', () => {
  for (const bad of [
    fmp4Playlist.replace('init.mp4', 'https://evil.example/init.mp4'),
    fmp4Playlist.replace('a.mp4', 'https://evil.example/a.mp4'),
    fmp4Playlist.replace('#EXTINF:2,', '#EXT-X-BYTERANGE:100@0\n#EXTINF:2,'),
    '#EXT-X-KEY:METHOD=AES-128\n' + fmp4Playlist,
    fmp4Playlist.replace('a.mp4', 'a.ts'),
    fmp4Playlist.replace('URI="init.mp4"', 'URI="init.mp4",BYTERANGE="100@0"'),
    fmp4Playlist.replace(
      '#EXT-X-MAP:URI="init.mp4"\n',
      '#EXTINF:2,\na.ts\n#EXT-X-MAP:URI="init.mp4"\n',
    ),
  ]) {
    assert.throws(() => parseHlsMedia(bad, base));
  }
});

test('HLS resource MIME types distinguish MPEG-TS and fragmented MP4', () => {
  assert.equal(hlsResourceContentType('mpegts'), 'video/mp2t');
  assert.equal(hlsResourceContentType('fmp4'), 'video/mp4');
});

test('downloads reject redirect responses, oversized declared and chunked bodies', async () => {
  let init;
  await assert.rejects(
    fetchHlsBytes(base, {
      maxBytes: 5,
      fetchImpl: async (_url, options) => {
        init = options;
        return new Response('', {
          status: 302,
          headers: { Location: 'https://evil.example' },
        });
      },
    }),
  );
  assert.equal(init.redirect, 'error');
  await assert.rejects(
    fetchHlsBytes(base, {
      maxBytes: 5,
      fetchImpl: async () => new Response('abcdef'),
    }),
  );
  await assert.rejects(
    fetchHlsBytes(base, {
      maxBytes: 5,
      fetchImpl: async () =>
        new Response('a', { headers: { 'content-length': '100' } }),
    }),
  );
});

test('one session is reserved before await; disk-free cache and capacity remain bounded', async () => {
  const manager = createHlsPuller({
    limits: {
      ...HLS_LIMITS,
      sessions: 1,
      segmentBytes: 4,
      sessionBytes: 6,
      segments: 2,
      pollMs: 100000,
    },
    fetchImpl: async (url) =>
      new Response(url.endsWith('.m3u8') ? playlist : 'abc'),
  });
  const [a, b] = await Promise.all([
    manager.ensure('a', base),
    manager.ensure('a', base),
  ]);
  assert.equal(a, b);
  await assert.rejects(manager.ensure('b', base));
  assert.equal(await manager.waitReady(a), true);
  assert.deepEqual(manager.stats(), { sessions: 1, bytes: 6 });
  const text = await manager.buildPlaylist(a, 'a');
  assert.match(text, /seg_0\.ts\?session=/);
  assert.equal(manager.getSegment('a', 'stale-token', 0), null);
  assert.equal(manager.getSegment('a', a.token, 0).length, 3);
  manager.stop('a', 'stale-token');
  assert.equal(manager.stats().sessions, 1);
  manager.stop('a', a.token);
  assert.deepEqual(manager.stats(), { sessions: 0, bytes: 0 });
  await manager.shutdown();
});

test('shutdown cancels in-flight downloads and late responses cannot refill cache', async () => {
  let observed;
  const manager = createHlsPuller({
    fetchImpl: async (_url, { signal }) => {
      observed = signal;
      return new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('cancelled')), {
          once: true,
        }),
      );
    },
  });
  const entry = await manager.ensure('a', base);
  await manager.shutdown();
  assert.equal(observed.aborted, true);
  assert.equal(entry.stopping, true);
  assert.deepEqual(manager.stats(), { sessions: 0, bytes: 0 });
  await assert.rejects(manager.ensure('a', base));
});

test('idle cleanup stops all polling without a background sweep', async () => {
  let calls = 0;
  const manager = createHlsPuller({
    limits: { ...HLS_LIMITS, idleMs: 15, pollMs: 100000 },
    fetchImpl: async (url) => {
      calls++;
      return new Response(url.endsWith('.m3u8') ? playlist : 'abc');
    },
  });
  await manager.ensure('a', base);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(manager.stats(), { sessions: 0, bytes: 0 });
  const stoppedCalls = calls;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, stoppedCalls);
  await manager.shutdown();
});

test('agency sequence rollback creates a monotonic local discontinuity', async () => {
  let current = playlist;
  const manager = createHlsPuller({
    limits: { ...HLS_LIMITS, pollMs: 5 },
    fetchImpl: async (url) =>
      new Response(url.endsWith('.m3u8') ? current : 'abc'),
  });
  const entry = await manager.ensure('a', base);
  await manager.waitReady(entry);
  const before = await manager.buildPlaylist(entry, 'a');
  assert.match(before, /seg_0\.ts/);
  current = playlist.replace('SEQUENCE:12', 'SEQUENCE:0');
  await new Promise((r) => setTimeout(r, 30));
  const after = await manager.buildPlaylist(entry, 'a');
  assert.match(
    after,
    /#EXT-X-DISCONTINUITY\n#EXTINF:2\.000,\n\/api\/cctv\/media\/a\/seg_3\.ts/,
  );
  await manager.shutdown();
});

test('upstream discontinuity tags survive the media parser', () => {
  const parsed = parseHlsMedia(
    playlist.replace('a.ts', 'a.ts\n#EXT-X-DISCONTINUITY'),
    base,
  ).segments;
  assert.equal(parsed[0].discontinuity, false);
  assert.equal(parsed[1].discontinuity, true);
});

test('fMP4 init and media share the bounded cache, lease and cleanup lifecycle', async () => {
  const manager = createHlsPuller({
    limits: {
      ...HLS_LIMITS,
      segmentBytes: 16,
      sessionBytes: 12,
      segments: 2,
      pollMs: 100000,
    },
    fetchImpl: async (url) => {
      if (url.endsWith('.m3u8')) return new Response(fmp4Playlist);
      if (url.endsWith('init.mp4')) return new Response('init');
      return new Response('seg');
    },
  });
  const entry = await manager.ensure('iowa', base, 'viewer-a');
  assert.equal(await manager.waitReady(entry), true);
  assert.deepEqual(manager.stats(), { sessions: 1, bytes: 10 });
  const local = await manager.buildPlaylist(entry, 'iowa', 'viewer-a');
  assert.match(local, /#EXT-X-VERSION:10/);
  assert.match(
    local,
    /#EXT-X-MAP:URI="\/api\/cctv\/media\/iowa\/init\.mp4\?session=/,
  );
  assert.match(local, /#EXT-X-MEDIA-SEQUENCE:0/);
  assert.match(local, /#EXTINF:2\.000,\n\/api\/cctv\/media\/iowa\/seg_0\.mp4/);
  assert.equal(manager.getInit('iowa', 'stale', 'viewer-a'), null);
  assert.equal(manager.getInit('iowa', entry.token, 'wrong-lease'), null);
  assert.equal(
    manager.getInit('iowa', entry.token, 'viewer-a').toString(),
    'init',
  );
  assert.equal(
    manager.getSegment('iowa', entry.token, 0, 'viewer-a', 'mpegts'),
    null,
  );
  assert.equal(
    manager.getSegment('iowa', entry.token, 0, 'viewer-a', 'fmp4').toString(),
    'seg',
  );
  manager.release('iowa', 'viewer-a');
  assert.deepEqual(manager.stats(), { sessions: 0, bytes: 0 });
  assert.equal(entry.init, null);
  assert.equal(entry.segments.size, 0);
  await manager.shutdown();
});

test('an upstream initialization change discards stale init and media bytes', async () => {
  let generation = 'a';
  const manifest = () =>
    fmp4Playlist
      .replace('init.mp4', `init-${generation}.mp4`)
      .replaceAll('.mp4\n', `-${generation}.mp4\n`);
  const manager = createHlsPuller({
    limits: { ...HLS_LIMITS, pollMs: 5 },
    fetchImpl: async (url) => {
      if (url.endsWith('.m3u8')) return new Response(manifest());
      if (url.includes('init-')) return new Response(`init-${generation}`);
      return new Response(`seg-${generation}`);
    },
  });
  const entry = await manager.ensure('iowa', base, 'viewer');
  await manager.waitReady(entry);
  assert.equal(
    manager.getInit('iowa', entry.token, 'viewer').toString(),
    'init-a',
  );
  generation = 'b';
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    manager.getInit('iowa', entry.token, 'viewer').toString(),
    'init-b',
  );
  assert.ok(
    [...entry.segments.values()].every(
      (segment) => segment.body.toString() === 'seg-b',
    ),
  );
  assert.equal(
    manager.stats().bytes,
    Buffer.byteLength('init-b') +
      [...entry.segments.values()].reduce(
        (total, segment) => total + segment.body.length,
        0,
      ),
  );
  await manager.shutdown();
});

test('a reused agency sequence with changed segment URI cannot remain stale', async () => {
  let current = playlist;
  const manager = createHlsPuller({
    limits: { ...HLS_LIMITS, pollMs: 5 },
    fetchImpl: async (url) =>
      new Response(url.endsWith('.m3u8') ? current : 'abc'),
  });
  const entry = await manager.ensure('a', base);
  await manager.waitReady(entry);
  current = playlist.replaceAll('.ts', '.ts?generation=2');
  await new Promise((r) => setTimeout(r, 30));
  assert.match(
    await manager.buildPlaylist(entry, 'a'),
    /#EXT-X-DISCONTINUITY\n#EXTINF:2\.000,\n\/api\/cctv\/media\/a\/seg_3\.ts/,
  );
  await manager.shutdown();
});

test('two consumers share downloads but release and abandoned expiry are independent', async () => {
  let downloads = 0;
  const manager = createHlsPuller({
    limits: { ...HLS_LIMITS, pollMs: 100000, leasesPerSession: 2 },
    fetchImpl: async (url) => {
      downloads++;
      return new Response(url.endsWith('.m3u8') ? playlist : 'abc');
    },
  });
  const [a, b] = await Promise.all([
    manager.ensure('camera', base, 'viewer-a'),
    manager.ensure('camera', base, 'viewer-b'),
  ]);
  assert.equal(a, b);
  await manager.waitReady(a);
  assert.equal(downloads, 4); // One manifest and three segments, not per consumer.
  assert.equal(a.leases.size, 2);
  await assert.rejects(manager.ensure('camera', base, 'viewer-c'));
  manager.release('camera', 'viewer-a');
  assert.equal(manager.stats().sessions, 1);
  assert.equal(manager.getSegment('camera', a.token, 0, 'viewer-a'), null);
  assert.equal(manager.getSegment('camera', a.token, 0, 'viewer-b').length, 3);
  assert.match(
    await manager.buildPlaylist(b, 'camera', 'viewer-b'),
    /lease=viewer-b/,
  );
  manager.release('camera', 'viewer-a'); // Duplicate/late release cannot stop B.
  assert.equal(b.controller.signal.aborted, false);
  manager.release('camera', 'viewer-b');
  assert.equal(b.controller.signal.aborted, true);
  assert.deepEqual(manager.stats(), { sessions: 0, bytes: 0 });
  await manager.shutdown();
});

test('an abandoned consumer expires while a renewed consumer keeps the session', async () => {
  const manager = createHlsPuller({
    limits: { ...HLS_LIMITS, idleMs: 80, pollMs: 100000 },
    fetchImpl: async (url) =>
      new Response(url.endsWith('.m3u8') ? playlist : 'abc'),
  });
  const entry = await manager.ensure('camera', base, 'abandoned');
  await manager.ensure('camera', base, 'active');
  await new Promise((r) => setTimeout(r, 50));
  await manager.ensure('camera', base, 'active');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(entry.leases.has('abandoned'), false);
  assert.equal(entry.leases.has('active'), true);
  assert.equal(entry.controller.signal.aborted, false);
  await manager.shutdown();
});

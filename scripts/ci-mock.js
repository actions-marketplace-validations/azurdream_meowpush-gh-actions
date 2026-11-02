import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const stateFile = join(
  process.env.RUNNER_TEMP || tmpdir(),
  'meowpush-action-ci-mock.json',
);
const keys = ['mpdv0000000000000001', 'mpgp0000000000000002'];
const notificationId = '019cf5f1-7f2d-7d18-8be1-6f27e1916b52';
const mode = process.argv[2];

async function readState() {
  return JSON.parse(await readFile(stateFile, 'utf8'));
}

if (mode === 'serve') {
  const counts = {};
  const errors = [];
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/__stats') {
      response.end(JSON.stringify({ counts, errors }));
      return;
    }
    if (request.url === '/__stop') {
      response.end('{}');
      server.close();
      server.closeIdleConnections();
      return;
    }
    counts[request.url] = (counts[request.url] || 0) + 1;
    try {
      assert.equal(request.method, 'POST');
      assert.match(request.headers['content-type'], /^application\/json\b/);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8');
      const payload = JSON.parse(text);
      if (request.url === '/success') {
        assert.deepEqual(payload.keys, keys);
        assert.equal(payload.body, 'CI ✓\nLine 2');
        assert.equal(payload.title, 'Build result');
        assert.equal(payload.badge, 0);
        assert.equal(payload.ttl, 0);
        assert.match(text, /9007199254740993/);
        assert.match(text, /0\.123456789012345678901/);
        assert.equal(payload.sound, undefined);
        response.end(
          JSON.stringify({
            notification_id: notificationId,
            accepted: 1,
            failed: 0,
            results: [
              {
                key: keys[0],
                source_keys: keys,
                status: 'accepted',
                transport: 'apns',
                message_id: 'fixture-message',
              },
            ],
          }),
        );
      } else if (request.url === '/failure') {
        assert.equal(payload.key, keys[0]);
        response.end(
          JSON.stringify({
            notification_id: notificationId,
            accepted: 0,
            failed: 1,
            results: [
              {
                key: keys[0],
                source_keys: [keys[0]],
                status: 'failed',
                transport: 'apns',
                reason: 'upstream_unavailable',
                detail: `Fixture failure for ${keys[0]}`,
              },
            ],
          }),
        );
      } else if (request.url === '/http-error') {
        assert.equal(payload.key, keys[0]);
        response.statusCode = 503;
        response.end(
          JSON.stringify({
            error: {
              code: 'fixture_unavailable',
              message: `Fixture unavailable for ${keys[0]}`,
            },
          }),
        );
      } else {
        throw new Error('Unexpected fixture route');
      }
    } catch (error) {
      errors.push(error.message);
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          error: {
            code: 'fixture_invalid_request',
            message: 'Invalid fixture request',
          },
        }),
      );
    }
  });
  server.listen(0, '127.0.0.1', async () => {
    await writeFile(
      stateFile,
      JSON.stringify({
        pid: process.pid,
        endpoint: `http://127.0.0.1:${server.address().port}`,
      }),
    );
  });
  server.on('error', () => {
    process.exitCode = 1;
  });
  // A cancelled job also has runner process cleanup; this bounds orphan lifetime locally.
  const lifetime = setTimeout(
    () => {
      server.closeAllConnections();
      server.close();
    },
    10 * 60 * 1000,
  );
  lifetime.unref();
} else if (mode === 'start') {
  await mkdir(dirname(stateFile), { recursive: true });
  await rm(stateFile, { force: true });
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), 'serve'],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  let spawnError;
  child.once('error', (error) => {
    spawnError = error;
  });
  child.once('exit', (code) => {
    if (code !== 0)
      spawnError = new Error(`Local fixture server exited with code ${code}`);
  });
  child.unref();
  let state;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (spawnError) throw spawnError;
    try {
      state = await readState();
      break;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError))
        throw error;
      await delay(50);
    }
  }
  assert(state, 'Local fixture server did not become ready');
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `endpoint=${state.endpoint}\n`);
  }
  console.log(`Local fixture ready at ${state.endpoint}`);
} else if (mode === 'verify') {
  const { endpoint } = await readState();
  const response = await fetch(`${endpoint}/__stats`, {
    signal: AbortSignal.timeout(5000),
  });
  const stats = await response.json();
  assert.deepEqual(stats.errors, []);
  assert.deepEqual(stats.counts, {
    '/success': 1,
    '/failure': 1,
    '/http-error': 1,
  });
  console.log('All fixture requests were valid and sent exactly once.');
} else if (mode === 'stop') {
  try {
    const { endpoint } = await readState();
    await fetch(`${endpoint}/__stop`, { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    await rm(stateFile, { force: true });
  }
} else {
  throw new Error('Usage: node scripts/ci-mock.js start|verify|stop');
}

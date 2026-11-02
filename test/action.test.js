import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runAction } from '../src/action.js';
import { readCredentials, readRequest } from '../src/inputs.js';
import { MAX_RESPONSE_BYTES, sendNotification } from '../src/send.js';

const KEY = 'mpdv0000000000000001';
const GROUP_KEY = 'mpgp0000000000000002';
const APP_KEY = 'mpap00000000000000000000000001';
const UNKNOWN_KEY = 'mpdv0000000000000003';
const ID = '019cf5f1-7f2d-7d18-8be1-6f27e1916b52';
const root = fileURLToPath(new URL('../', import.meta.url));

function coreFor(values = {}) {
  const inputs = { key: KEY, body: 'Build complete', ...values };
  const events = [];
  const outputs = {};
  return {
    events,
    outputs,
    getInput(name, { trimWhitespace = true } = {}) {
      const value = inputs[name] ?? '';
      return trimWhitespace ? value.trim() : value;
    },
    setSecret(value) {
      events.push({ type: 'mask', value });
    },
    setOutput(name, value) {
      outputs[name] = value;
      events.push({ type: 'output', name, value });
    },
    info(value) {
      events.push({ type: 'info', value });
    },
    setFailed(value) {
      events.push({ type: 'failed', value });
    },
  };
}

function requestFor(values = {}) {
  const core = coreFor(values);
  return readRequest(core, readCredentials(core));
}

function result(status = 'accepted', overrides = {}) {
  return {
    key: KEY,
    source_keys: [KEY],
    status,
    transport: 'apns',
    ...overrides,
  };
}

function aggregate(results = [result()], overrides = {}) {
  return {
    notification_id: ID,
    accepted: results.filter((item) => item.status === 'accepted').length,
    failed: results.filter((item) => item.status === 'failed').length,
    results,
    ...overrides,
  };
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

async function mockServer(t, handler) {
  const calls = [];
  const errors = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const text = Buffer.concat(chunks).toString('utf8');
      calls.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        text,
      });
      await handler({ req, res, text });
    })().catch((error) => {
      errors.push(error);
      res.destroy();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    assert.deepEqual(errors, [], 'mock handler assertions must pass');
  });
  return { calls, endpoint: `http://127.0.0.1:${server.address().port}/` };
}

function assertNoCredentials(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const key of [KEY, GROUP_KEY, APP_KEY, UNKNOWN_KEY]) {
    assert.equal(serialized.includes(key), false, `must not contain ${key}`);
  }
}

test('minimal request defaults to the public endpoint and omits optional fields', () => {
  const request = requestFor();
  assert.equal(request.endpoint, 'https://send.meowpush.com/');
  assert.equal(request.timeoutMs, 30_000);
  assert.deepEqual(JSON.parse(request.payload), {
    key: KEY,
    body: 'Build complete',
  });
});

test('preserves whitespace, multiline Unicode, JSON text and explicitly supplied zero values', () => {
  const body = '  # 构建完成 🐈\n\n{"build": "green"}\n  ';
  const request = requestFor({
    body,
    title: ' Title ',
    subtitle: '\nSubtitle\n',
    badge: '0',
    ttl: ' 0 ',
    level: 'time-sensitive',
    icon: 'https://example.com/icon.png',
    image: 'https://example.com/image.png',
    url: 'my-app://build/42',
    group: 'ci',
    'collapse-id': 'build-42',
  });
  assert.deepEqual(JSON.parse(request.payload), {
    key: KEY,
    body,
    title: ' Title ',
    subtitle: '\nSubtitle\n',
    badge: 0,
    ttl: 0,
    level: 'time-sensitive',
    icon: 'https://example.com/icon.png',
    image: 'https://example.com/image.png',
    url: 'my-app://build/42',
    group: 'ci',
    collapse_id: 'build-42',
  });
});

test('data retains its exact JSON numeric values and cannot override top-level fields', () => {
  const data =
    '{ "big": 9007199254740993, "decimal": 0.12345678901234567890123456789, "exponent": 1e400, "body": "other", "nested": {"__proto__": 1} }';
  const request = requestFor({ data });
  assert.equal(request.payload.endsWith(`"data":${data}}`), true);
  assert.equal(JSON.parse(request.payload).body, 'Build complete');
  assert.equal(JSON.parse(request.payload).data.body, 'other');
  assert.equal(
    Object.hasOwn(JSON.parse(request.payload).data.nested, '__proto__'),
    true,
  );
});

test('normalizes key whitespace and keeps input order for output indexes', () => {
  const core = coreFor({ key: '', keys: ` [" ${GROUP_KEY} ", "${KEY}"] ` });
  const credentials = readCredentials(core);
  assert.deepEqual(credentials.keys, [GROUP_KEY, KEY]);
  assert.deepEqual(JSON.parse(readRequest(core, credentials).payload).keys, [
    GROUP_KEY,
    KEY,
  ]);
  const masked = core.events
    .filter((event) => event.type === 'mask')
    .map((event) => event.value);
  assert.ok(masked.includes(KEY));
  assert.ok(masked.includes(GROUP_KEY));
});

test('supports an Application key alone through either key input form', () => {
  assert.equal(JSON.parse(requestFor({ key: APP_KEY }).payload).key, APP_KEY);
  assert.deepEqual(
    JSON.parse(requestFor({ key: '', keys: JSON.stringify([APP_KEY]) }).payload)
      .keys,
    [APP_KEY],
  );
});

test('does not duplicate documented business limits in local validation', () => {
  const keys = Array.from(
    { length: 101 },
    (_, index) => `server-validates-key-${index}`,
  );
  const request = requestFor({
    key: '',
    keys: JSON.stringify(keys),
    body: 'x'.repeat(5000),
    title: 'x'.repeat(300),
    badge: '10000',
    ttl: '3000000',
    level: 'server-defined',
  });
  const payload = JSON.parse(request.payload);
  assert.equal(payload.keys.length, 101);
  assert.equal(payload.body.length, 5000);
  assert.equal(payload.badge, 10000);
  assert.equal(payload.ttl, 3000000);
});

test('custom endpoints support both HTTP and HTTPS, ports, paths and query routing', () => {
  for (const endpoint of [
    'http://example.com:8080/send?route=ci',
    'https://example.com/notify',
  ]) {
    assert.equal(requestFor({ endpoint }).endpoint, endpoint);
  }
});

test('timeout is an Action-side deadline in milliseconds', () => {
  for (const timeout of ['1', '250', '2147483647']) {
    const request = requestFor({ timeout });
    assert.equal(request.timeoutMs, Number(timeout));
    assert.equal(Object.hasOwn(JSON.parse(request.payload), 'timeout'), false);
  }
});

test('rejects invalid input before any network call and still provides failure outputs', async (t) => {
  const cases = [
    ['missing keys', { key: '' }],
    ['both key forms', { keys: JSON.stringify([GROUP_KEY]) }],
    ['malformed keys JSON', { key: '', keys: `["${KEY}",` }],
    ['keys object', { key: '', keys: '{}' }],
    ['empty keys array', { key: '', keys: '[]' }],
    ['nonstring key', { key: '', keys: '[1]' }],
    ['empty key member', { key: '', keys: '[" "]' }],
    [
      'duplicate keys after trimming',
      { key: '', keys: JSON.stringify([KEY, ` ${KEY} `]) },
    ],
    [
      'mixed application key',
      { key: '', keys: JSON.stringify([APP_KEY, KEY]) },
    ],
    ['empty body', { body: '' }],
    ['data array', { data: '[]' }],
    ['data null', { data: 'null' }],
    ['data scalar', { data: '2' }],
    ['malformed data', { data: '{"secret":' }],
    ['reserved aps', { data: '{"aps": {}}' }],
    ['reserved mp', { data: '{"mp": null}' }],
    ['negative badge', { badge: '-1' }],
    ['fractional ttl', { ttl: '1.5' }],
    ['exponent ttl', { ttl: '1e3' }],
    ['unsafe integer', { badge: '9007199254740993' }],
    ['relative endpoint', { endpoint: '/send' }],
    ['unsupported endpoint scheme', { endpoint: 'file:///tmp/test' }],
    [
      'embedded credentials',
      { endpoint: 'https://user:password@example.com/' },
    ],
    ['zero timeout', { timeout: '0' }],
    ['negative timeout', { timeout: '-1' }],
    ['fractional timeout', { timeout: '1.5' }],
    ['timer overflow', { timeout: '2147483648' }],
  ];
  for (const [name, inputs] of cases) {
    await t.test(name, async () => {
      const core = coreFor(inputs);
      let calls = 0;
      const outputs = await runAction(core, {
        fetchImpl: async () => {
          calls++;
          throw new Error('must not send');
        },
      });
      assert.equal(calls, 0);
      assert.equal(outputs.success, 'false');
      assert.equal(outputs['error-code'], 'action_invalid_input');
      assert.equal(outputs.accepted, '');
      assert.equal(outputs['http-status'], '');
      assert.equal(outputs.results, '[]');
      assert.equal(core.events.at(-1).type, 'failed');
      assert.equal(
        core.events.filter((event) => event.type === 'output').length,
        8,
      );
      assertNoCredentials(outputs);
    });
  }
});

test('all parsed credential values are masked before validation reports a conflict', async () => {
  const core = coreFor({ keys: JSON.stringify([GROUP_KEY, APP_KEY]) });
  await runAction(core);
  const masks = core.events.filter((event) => event.type === 'mask');
  assert.ok(masks.some((event) => event.value === KEY));
  assert.ok(masks.some((event) => event.value === GROUP_KEY));
  assert.ok(masks.some((event) => event.value === APP_KEY));
  const firstOutput = core.events.findIndex((event) => event.type === 'output');
  assert.ok(
    core.events.slice(0, firstOutput).every((event) => event.type === 'mask'),
  );
});

test('successful local HTTP POST preserves request data and returns sanitized fanout results', async (t) => {
  const body = '  成功 🐈\n[Build](https://example.com/)\n';
  const data = '{"id":9007199254740993,"ratio":0.123456789012345678901}';
  const response = aggregate([
    result('accepted', {
      source_keys: [GROUP_KEY, KEY],
      message_id: 'provider-42',
      delivery_adapter: 'direct',
      delivery_policy: 'default',
    }),
    result('accepted', {
      key: GROUP_KEY,
      source_keys: [GROUP_KEY],
      transport: 'future-provider',
    }),
  ]);
  const server = await mockServer(t, ({ res }) => json(res, response));
  const core = coreFor({
    key: '',
    keys: JSON.stringify([GROUP_KEY, KEY]),
    body,
    data,
    endpoint: `${server.endpoint}custom?ci=1`,
  });
  const outputs = await runAction(core);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].method, 'POST');
  assert.equal(server.calls[0].url, '/custom?ci=1');
  assert.equal(server.calls[0].headers['content-type'], 'application/json');
  assert.equal(
    Number(server.calls[0].headers['content-length']),
    Buffer.byteLength(server.calls[0].text),
  );
  assert.equal(server.calls[0].headers.authorization, undefined);
  assert.equal(JSON.parse(server.calls[0].text).body, body);
  assert.ok(server.calls[0].text.includes(data));
  assert.equal(outputs.success, 'true');
  assert.equal(outputs['notification-id'], ID);
  assert.equal(outputs.accepted, '2');
  assert.equal(outputs.failed, '0');
  assert.equal(outputs['http-status'], '200');
  assert.equal(outputs['error-code'], '');
  assert.equal(outputs['error-message'], '');
  const safeResults = JSON.parse(outputs.results);
  assert.deepEqual(safeResults[0], {
    key_index: 1,
    source_key_indexes: [0, 1],
    status: 'accepted',
    transport: 'apns',
    message_id: 'provider-42',
    delivery_adapter: 'direct',
    delivery_policy: 'default',
  });
  assert.equal(safeResults[1].key_index, 0);
  assert.equal(safeResults[1].transport, 'future-provider');
  assertNoCredentials(outputs);
  assert.equal(core.events.at(-1).type, 'info');
  assert.equal(
    core.events.some((event) => event.type === 'failed'),
    false,
  );
});

test('partial, total and empty-target 200 responses fail after writing their aggregate outputs', async (t) => {
  for (const [name, response, code] of [
    [
      'partial',
      aggregate([
        result(),
        result('failed', {
          reason: 'quota_exceeded',
          retry_at: '2026-11-01T00:00:00Z',
        }),
      ]),
      'action_delivery_failed',
    ],
    [
      'all failed',
      aggregate([result('failed', { reason: 'unknown_key', transport: null })]),
      'action_delivery_failed',
    ],
    ['empty group', aggregate([]), 'action_no_targets'],
  ]) {
    await t.test(name, async (t) => {
      const server = await mockServer(t, ({ res }) => json(res, response));
      const core = coreFor({ endpoint: server.endpoint });
      const outputs = await runAction(core);
      assert.equal(outputs.success, 'false');
      assert.equal(outputs.accepted, String(response.accepted));
      assert.equal(outputs.failed, String(response.failed));
      assert.equal(outputs['notification-id'], ID);
      assert.equal(outputs['error-code'], code);
      assert.equal(JSON.parse(outputs.results).length, response.results.length);
      assert.equal(core.events.at(-1).type, 'failed');
      assert.equal(
        core.events.filter((event) => event.type === 'output').length,
        8,
      );
      assert.equal(server.calls.length, 1);
    });
  }
});

test('non-2xx aggregate responses retain counters and per-target failures', async (t) => {
  for (const status of [400, 404, 429, 502]) {
    await t.test(String(status), async (t) => {
      const response =
        status === 400
          ? aggregate([])
          : aggregate([result('failed', { reason: 'unknown_key' })]);
      const server = await mockServer(t, ({ res }) =>
        json(res, response, status),
      );
      const outputs = await sendNotification(
        requestFor({ endpoint: server.endpoint }),
      );
      assert.equal(outputs.success, 'false');
      assert.equal(outputs['http-status'], String(status));
      assert.equal(outputs['error-code'], 'action_http_error');
      assert.equal(outputs.accepted, '0');
      assert.equal(outputs.failed, String(response.failed));
      assert.equal(outputs['notification-id'], ID);
      assert.equal(server.calls.length, 1);
    });
  }
});

test('API error envelope retains its code and redacts credential-like values from error messages', async (t) => {
  const server = await mockServer(t, ({ res }) => {
    json(
      res,
      {
        error: {
          code: 'quota_exceeded',
          message: `Not accepted: ${KEY}; other ${UNKNOWN_KEY}`,
        },
      },
      429,
    );
  });
  const core = coreFor({ endpoint: server.endpoint });
  const outputs = await runAction(core);
  assert.equal(outputs['error-code'], 'quota_exceeded');
  assert.equal(outputs['http-status'], '429');
  assert.equal(
    outputs['error-message'],
    'Not accepted: [REDACTED]; other [REDACTED]',
  );
  assert.equal(outputs.accepted, '');
  assertNoCredentials(outputs);
  assertNoCredentials(core.events.filter((event) => event.type !== 'mask'));
});

test('result output excludes unknown fields and removes keys even if not present in inputs', async (t) => {
  const server = await mockServer(t, ({ res }) =>
    json(
      res,
      aggregate(
        [
          result('failed', {
            key: UNKNOWN_KEY,
            source_keys: [KEY, UNKNOWN_KEY],
            detail: `${KEY} and ${UNKNOWN_KEY}\n::error::untrusted`,
            message_id: `provider-${KEY}`,
            reason: 'rejected',
            extra: { credential: APP_KEY },
          }),
        ],
        { arbitrary_secret: GROUP_KEY },
      ),
    ),
  );
  const outputs = await sendNotification(
    requestFor({ endpoint: server.endpoint }),
  );
  const safe = JSON.parse(outputs.results)[0];
  assert.equal(safe.key_index, null);
  assert.deepEqual(safe.source_key_indexes, [0, null]);
  assert.equal(safe.detail, '[REDACTED] and [REDACTED]\n::error::untrusted');
  assert.equal(safe.message_id, 'provider-[REDACTED]');
  assert.equal(Object.hasOwn(safe, 'extra'), false);
  assert.equal(Object.hasOwn(safe, 'key'), false);
  assert.equal(Object.hasOwn(safe, 'source_keys'), false);
  assertNoCredentials(outputs);
});

test('invalid JSON and malformed success schemas cannot become successful notifications', async (t) => {
  const badResponses = [
    ['gateway HTML', `<html>${KEY}</html>`],
    ['empty body', ''],
    ['scalar', 'true'],
    ['missing counts', JSON.stringify({ notification_id: ID, results: [] })],
    ['string counts', JSON.stringify(aggregate([], { accepted: '0' }))],
    ['negative counts', JSON.stringify(aggregate([], { failed: -1 }))],
    [
      'mismatched counts',
      JSON.stringify(aggregate([result()], { accepted: 2 })),
    ],
    ['invalid status', JSON.stringify(aggregate([result('delivered')]))],
    [
      'missing transport',
      JSON.stringify(aggregate([result('accepted', { transport: undefined })])),
    ],
    [
      'missing sources',
      JSON.stringify(aggregate([result('accepted', { source_keys: [] })])),
    ],
    [
      'invalid optional type',
      JSON.stringify(aggregate([result('accepted', { detail: {} })])),
    ],
  ];
  for (const [name, text] of badResponses) {
    await t.test(name, async (t) => {
      const server = await mockServer(t, ({ res }) => res.end(text));
      const outputs = await sendNotification(
        requestFor({ endpoint: server.endpoint }),
      );
      assert.equal(outputs.success, 'false');
      assert.equal(outputs['error-code'], 'action_invalid_response');
      assert.equal(outputs.accepted, '');
      assert.equal(outputs.results, '[]');
      assertNoCredentials(outputs);
    });
  }
});

test('non-JSON HTTP failure exposes only the status, not a gateway body', async (t) => {
  const server = await mockServer(t, ({ res }) => {
    res.writeHead(503);
    res.end(`Credentials: ${KEY}; private upstream diagnostic`);
  });
  const outputs = await sendNotification(
    requestFor({ endpoint: server.endpoint }),
  );
  assert.equal(outputs['http-status'], '503');
  assert.equal(outputs['error-code'], 'action_http_error');
  assert.equal(outputs['error-message'].includes('private'), false);
  assertNoCredentials(outputs);
  assert.equal(server.calls.length, 1);
});

test('a redirect is not followed or retried and cannot forward credentials to another endpoint', async (t) => {
  const destination = await mockServer(t, ({ res }) => json(res, aggregate()));
  const redirect = await mockServer(t, ({ res }) => {
    res.writeHead(307, { location: destination.endpoint });
    res.end();
  });
  const outputs = await sendNotification(
    requestFor({ endpoint: redirect.endpoint }),
  );
  assert.equal(outputs.success, 'false');
  assert.equal(outputs['http-status'], '307');
  assert.equal(outputs['error-code'], 'action_http_error');
  assert.equal(redirect.calls.length, 1);
  assert.equal(destination.calls.length, 0);
});

test('HTTP 421 cannot cause fetch to replay a notification', async (t) => {
  let attempts = 0;
  const server = await mockServer(t, ({ res }) => {
    attempts++;
    if (attempts === 1) {
      json(
        res,
        { error: { code: 'misdirected_request', message: 'Wrong server' } },
        421,
      );
    } else {
      json(res, aggregate());
    }
  });
  const outputs = await sendNotification(
    requestFor({ endpoint: server.endpoint }),
  );
  assert.equal(server.calls.length, 1);
  assert.equal(outputs.success, 'false');
  assert.equal(outputs['http-status'], '421');
  assert.equal(outputs['error-code'], 'misdirected_request');
});

test(
  'timeout covers waiting for response headers and does not retry',
  { timeout: 5000 },
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const received = Promise.withResolvers();
    const server = await mockServer(t, () => received.resolve());
    const pending = sendNotification(
      requestFor({ endpoint: server.endpoint, timeout: '100' }),
    );
    await received.promise;
    t.mock.timers.tick(100);
    const outputs = await pending;
    assert.equal(outputs['error-code'], 'action_timeout');
    assert.equal(outputs['http-status'], '');
    assert.match(outputs['error-message'], /may already have occurred/);
    assert.equal(server.calls.length, 1);
  },
);

test(
  'timeout remains active while an incomplete response body is streaming',
  { timeout: 5000 },
  async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const received = Promise.withResolvers();
    const server = await mockServer(t, ({ res }) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"notification_id":');
    });
    const pending = sendNotification(
      requestFor({ endpoint: server.endpoint, timeout: '100' }),
      {
        fetchImpl: async (...args) => {
          const response = await fetch(...args);
          received.resolve();
          return response;
        },
      },
    );
    await received.promise;
    t.mock.timers.tick(100);
    const outputs = await pending;
    assert.equal(outputs['error-code'], 'action_timeout');
    assert.equal(outputs['http-status'], '200');
    assert.equal(outputs.accepted, '');
    assert.equal(server.calls.length, 1);
  },
);

test('connection failure is sanitized and leaves counters unknown', async (t) => {
  const server = await mockServer(t, ({ req }) => req.socket.destroy());
  const outputs = await sendNotification(
    requestFor({ endpoint: server.endpoint }),
  );
  assert.equal(outputs.success, 'false');
  assert.equal(outputs['error-code'], 'action_network_error');
  assert.equal(outputs['http-status'], '');
  assert.equal(outputs.accepted, '');
  assert.equal(outputs.failed, '');
  assert.equal(server.calls.length, 1);
  assertNoCredentials(outputs);
});

test('oversized response bodies are rejected without exposing or waiting for their remainder', async (t) => {
  const server = await mockServer(t, ({ res }) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('x'.repeat(MAX_RESPONSE_BYTES + 1));
  });
  const outputs = await sendNotification({
    ...requestFor({ endpoint: server.endpoint }),
    timeoutMs: 1000,
  });
  assert.equal(outputs['error-code'], 'action_response_too_large');
  assert.equal(outputs['http-status'], '200');
  assert.equal(outputs.results, '[]');
  assert.equal(outputs.accepted, '');
});

test('output-size budget applies after redaction expansion', async (t) => {
  const server = await mockServer(t, ({ res }) => {
    json(
      res,
      aggregate([
        result('accepted', {
          key: 'x',
          source_keys: ['x'],
          message_id: 'x'.repeat(20_000),
        }),
      ]),
    );
  });
  const outputs = await sendNotification(
    requestFor({ key: 'x', endpoint: server.endpoint }),
  );
  assert.equal(outputs.success, 'false');
  assert.equal(outputs['error-code'], 'action_response_too_large');
  assert.equal(outputs.results, '[]');
});

function parseOutputFile(text) {
  const lines = text.split(/\r?\n/);
  const outputs = {};
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index]) continue;
    const marker = lines[index].indexOf('<<');
    assert.ok(marker > 0, `expected output-file delimiter: ${lines[index]}`);
    const name = lines[index].slice(0, marker);
    const delimiter = lines[index].slice(marker + 2);
    const values = [];
    while (++index < lines.length && lines[index] !== delimiter)
      values.push(lines[index]);
    assert.ok(index < lines.length, 'output delimiter must be closed');
    outputs[name] = values.join('\n');
  }
  return outputs;
}

async function bundledAction(t, values) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'meowpush-action-test-'),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, 'outputs');
  await writeFile(outputPath, '');
  const bundlePath = path.join(directory, 'index.cjs');
  await copyFile(path.join(root, 'dist/index.cjs'), bundlePath);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => {
      const normalized = name.toUpperCase();
      return (
        !normalized.startsWith('INPUT_') &&
        !normalized.startsWith('GITHUB_') &&
        !normalized.startsWith('ACTIONS_') &&
        !normalized.startsWith('RUNNER_') &&
        !normalized.startsWith('NODE_') &&
        !normalized.endsWith('_PROXY')
      );
    }),
  );
  Object.assign(env, {
    GITHUB_OUTPUT: outputPath,
    ...Object.fromEntries(
      Object.entries(values).map(([name, value]) => [
        `INPUT_${name.toUpperCase()}`,
        value,
      ]),
    ),
  });
  const child = spawn(process.execPath, [bundlePath], {
    cwd: directory,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timer = setTimeout(() => child.kill(), 10_000);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (text) => {
    stdout += text;
  });
  child.stderr.setEncoding('utf8').on('data', (text) => {
    stderr += text;
  });
  const [code, signal] = await once(child, 'close');
  clearTimeout(timer);
  assert.equal(signal, null, `child should exit normally; stderr=${stderr}`);
  const outputText = await readFile(outputPath, 'utf8');
  return {
    code,
    stdout,
    stderr,
    outputs: parseOutputFile(outputText),
    outputText,
  };
}

test('bundled Action runs outside the repository, needs no installed runtime dependencies, and writes usable outputs', async (t) => {
  const server = await mockServer(t, ({ res }) =>
    json(res, aggregate([result('accepted', { message_id: 'message-42' })])),
  );
  const child = await bundledAction(t, {
    key: KEY,
    body: '  CI 🐈\n',
    endpoint: server.endpoint,
  });
  assert.equal(child.code, 0, child.stderr);
  assert.equal(child.outputs.success, 'true');
  assert.equal(child.outputs['notification-id'], ID);
  assert.equal(child.outputs.accepted, '1');
  assert.equal(JSON.parse(child.outputs.results)[0].message_id, 'message-42');
  assert.equal(JSON.parse(server.calls[0].text).body, '  CI 🐈\n');
  assert.match(child.stdout, /::add-mask::/);
  assertNoCredentials(child.outputText);
  assertNoCredentials(
    child.stdout
      .split(/\r?\n/)
      .filter((line) => !line.startsWith('::add-mask::'))
      .join('\n'),
  );
});

test('bundled Action reports HTTP 421 without replaying the POST', async (t) => {
  let attempts = 0;
  const server = await mockServer(t, ({ res }) => {
    attempts++;
    if (attempts === 1) {
      json(
        res,
        { error: { code: 'misdirected_request', message: 'Wrong server' } },
        421,
      );
    } else {
      json(res, aggregate());
    }
  });
  const child = await bundledAction(t, {
    key: APP_KEY,
    body: 'CI 🐈',
    endpoint: server.endpoint,
  });
  assert.equal(child.code, 1, child.stderr);
  assert.equal(child.outputs.success, 'false');
  assert.equal(child.outputs['http-status'], '421');
  assert.equal(child.outputs['error-code'], 'misdirected_request');
  assert.equal(server.calls.length, 1);
  assert.equal(
    Number(server.calls[0].headers['content-length']),
    Buffer.byteLength(server.calls[0].text),
  );
});

test('bundled failure exits nonzero after publishing outputs, escaping server text as an annotation', async (t) => {
  const server = await mockServer(t, ({ res }) =>
    json(
      res,
      {
        error: {
          code: 'invalid_request',
          message: `${KEY}\n::error::untrusted%message`,
        },
      },
      400,
    ),
  );
  const child = await bundledAction(t, {
    key: KEY,
    body: 'CI',
    endpoint: server.endpoint,
  });
  assert.equal(child.code, 1, child.stderr);
  assert.equal(child.outputs.success, 'false');
  assert.equal(child.outputs['error-code'], 'invalid_request');
  assert.equal(child.outputs['http-status'], '400');
  assert.equal(
    child.outputs['error-message'],
    '[REDACTED]\n::error::untrusted%message',
  );
  assert.match(child.stdout, /%0A::error::untrusted%25message/);
  assertNoCredentials(child.outputText);
  assertNoCredentials(
    child.stdout
      .split(/\r?\n/)
      .filter((line) => !line.startsWith('::add-mask::'))
      .join('\n'),
  );
});

test('bundled input errors publish defaults without contacting an endpoint', async (t) => {
  const child = await bundledAction(t, { key: KEY, body: '' });
  assert.equal(child.code, 1);
  assert.equal(child.outputs['error-code'], 'action_invalid_input');
  assert.equal(child.outputs.accepted, '');
  assert.equal(child.outputs['http-status'], '');
  assert.equal(child.outputs.results, '[]');
  assert.equal(Object.keys(child.outputs).length, 8);
});

import assert from 'node:assert/strict';

const mode = process.argv[2];
const step = JSON.parse(process.env.ACTION_RESULT);
const outputs = step.outputs;
const keys = ['mpdv0000000000000001', 'mpgp0000000000000002'];
assert.equal(step.conclusion, 'success');
for (const key of keys) {
  assert(!JSON.stringify(outputs).includes(key), 'Output leaked a fixture key');
}
const results = JSON.parse(outputs.results);
for (const result of results) {
  assert(!('key' in result));
  assert(!('source_keys' in result));
}

if (mode === 'success') {
  assert.equal(step.outcome, 'success');
  assert.equal(outputs.success, 'true');
  assert.equal(outputs['http-status'], '200');
  assert.equal(outputs.accepted, '1');
  assert.equal(outputs.failed, '0');
  assert.equal(
    outputs['notification-id'],
    '019cf5f1-7f2d-7d18-8be1-6f27e1916b52',
  );
  assert.equal(outputs['error-code'], '');
  assert.equal(outputs['error-message'], '');
  assert.equal(results[0].key_index, 0);
  assert.deepEqual(results[0].source_key_indexes, [0, 1]);
  assert.equal(results[0].message_id, 'fixture-message');
} else if (mode === 'failure') {
  assert.equal(step.outcome, 'failure');
  assert.equal(outputs.success, 'false');
  assert.equal(outputs['http-status'], '200');
  assert.equal(outputs.accepted, '0');
  assert.equal(outputs.failed, '1');
  assert.equal(outputs['error-code'], 'action_delivery_failed');
  assert.equal(results[0].key_index, 0);
  assert.deepEqual(results[0].source_key_indexes, [0]);
  assert.equal(results[0].reason, 'upstream_unavailable');
} else if (mode === 'http-error') {
  assert.equal(step.outcome, 'failure');
  assert.equal(outputs.success, 'false');
  assert.equal(outputs['http-status'], '503');
  assert.equal(outputs.accepted, '');
  assert.equal(outputs.failed, '');
  assert.equal(outputs['error-code'], 'fixture_unavailable');
  assert.deepEqual(results, []);
} else {
  throw new Error('Expected success, failure or http-error fixture mode');
}
console.log(`${mode} outputs and step outcome verified.`);

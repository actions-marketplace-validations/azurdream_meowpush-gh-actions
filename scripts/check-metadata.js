import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDocument } from 'yaml';

async function readYaml(path) {
  const document = parseDocument(await readFile(path, 'utf8'), {
    uniqueKeys: true,
  });
  assert.equal(
    document.errors.length,
    0,
    `${path}: ${document.errors.map((error) => error.message).join('\n')}`,
  );
  return document.toJS();
}

const action = await readYaml('action.yml');
assert.equal(typeof action.name, 'string');
assert(action.name.length > 0);
assert.equal(typeof action.description, 'string');
assert(action.description.length > 0);
assert.equal(action.runs.using, 'node24');
assert.equal(action.runs.main, 'dist/index.cjs');
await access(action.runs.main);

const inputs = [
  'key',
  'keys',
  'body',
  'title',
  'subtitle',
  'level',
  'badge',
  'icon',
  'image',
  'url',
  'group',
  'collapse-id',
  'ttl',
  'data',
  'endpoint',
  'timeout',
];
const outputs = [
  'success',
  'notification-id',
  'accepted',
  'failed',
  'results',
  'http-status',
  'error-code',
  'error-message',
];
for (const [section, expected] of [
  ['inputs', inputs],
  ['outputs', outputs],
]) {
  assert.deepEqual(Object.keys(action[section]).sort(), expected.sort());
  for (const [id, metadata] of Object.entries(action[section])) {
    assert.match(id, /^[a-z][a-z0-9-]*$/);
    assert.equal(typeof metadata.description, 'string');
    assert(
      metadata.description.length > 0,
      `${section}.${id} needs a description`,
    );
    if ('default' in metadata) {
      assert.equal(typeof metadata.default, 'string');
    }
  }
}
assert.equal(action.inputs.body.required, true);
assert.notEqual(action.inputs.key.required, true);
assert.notEqual(action.inputs.keys.required, true);
assert.equal(action.inputs.endpoint.default, 'https://send.meowpush.com/');
assert.equal(action.inputs.timeout.default, '30000');

const workflowDirectory = '.github/workflows';
for (const filename of await readdir(workflowDirectory)) {
  if (!/\.ya?ml$/.test(filename)) continue;
  const workflow = await readYaml(join(workflowDirectory, filename));
  assert(workflow.on && workflow.jobs, `${filename}: missing trigger or jobs`);
  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    assert(job['runs-on'], `${filename}/${jobId}: missing runner`);
    assert(Array.isArray(job.steps), `${filename}/${jobId}: missing steps`);
    const ids = new Set();
    for (const step of job.steps) {
      assert(
        'uses' in step !== 'run' in step,
        `${filename}/${jobId}: step needs exactly one of uses/run`,
      );
      if (step.id) {
        assert(!ids.has(step.id), `${filename}/${jobId}: duplicate step id`);
        ids.add(step.id);
      }
      if (step.uses && !step.uses.startsWith('./')) {
        assert.match(
          step.uses,
          /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/,
          `${filename}: remote Actions must use a full commit SHA`,
        );
      }
    }
  }
}
const dependabot = await readYaml('.github/dependabot.yml');
assert.equal(dependabot.version, 2);
assert.deepEqual(
  dependabot.updates.map((update) => update['package-ecosystem']).sort(),
  ['github-actions', 'npm'],
);
console.log('Action metadata and YAML checks passed.');

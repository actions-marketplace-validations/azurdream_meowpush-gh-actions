// Exercise the CI fixtures locally. Actual runner outcome/conclusion handling is
// covered by uses: ./ in ci.yml; here those fields are derived from process exit.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'meowpush-ci-local-'));
const env = { ...process.env, RUNNER_TEMP: directory };
delete env.GITHUB_OUTPUT;
for (const key of Object.keys(env)) {
  if (key.startsWith('INPUT_')) delete env[key];
}

function run(args, extraEnv = {}) {
  return spawnSync(process.execPath, args, {
    env: { ...env, ...extraEnv },
    encoding: 'utf8',
    timeout: 20000,
  });
}

function parseOutputs(text) {
  const lines = text.split(/\r?\n/);
  const result = {};
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index]) continue;
    const [key, delimiter] = lines[index].split('<<');
    assert(delimiter, 'Expected a GITHUB_OUTPUT delimiter');
    const value = [];
    while (++index < lines.length && lines[index] !== delimiter)
      value.push(lines[index]);
    assert(index < lines.length, 'Unterminated GITHUB_OUTPUT value');
    result[key] = value.join('\n');
  }
  return result;
}

try {
  const start = run(['scripts/ci-mock.js', 'start']);
  assert.equal(start.status, 0, start.stderr || start.stdout);
  const { endpoint } = JSON.parse(
    await readFile(join(directory, 'meowpush-action-ci-mock.json'), 'utf8'),
  );
  for (const mode of ['success', 'failure', 'http-error']) {
    const outputFile = join(directory, `${mode}-output`);
    await writeFile(outputFile, '');
    const inputs =
      mode === 'success'
        ? {
            INPUT_KEYS: '["mpdv0000000000000001","mpgp0000000000000002"]',
            INPUT_BODY: 'CI ✓\nLine 2',
            INPUT_TITLE: 'Build result',
            INPUT_BADGE: '0',
            INPUT_TTL: '0',
            INPUT_DATA:
              '{"id":9007199254740993,"decimal":0.123456789012345678901}',
          }
        : { INPUT_KEY: 'mpdv0000000000000001', INPUT_BODY: 'Expected fixture' };
    const action = run(['dist/index.cjs'], {
      ...inputs,
      INPUT_ENDPOINT: `${endpoint}/${mode}`,
      GITHUB_OUTPUT: outputFile,
    });
    assert.equal(action.status, mode === 'success' ? 0 : 1, action.stderr);
    const step = {
      outputs: parseOutputs(await readFile(outputFile, 'utf8')),
      outcome: mode === 'success' ? 'success' : 'failure',
      conclusion: 'success',
    };
    const check = run(['scripts/ci-assert.js', mode], {
      ACTION_RESULT: JSON.stringify(step),
    });
    assert.equal(check.status, 0, check.stderr || check.stdout);
    process.stdout.write(check.stdout);
  }
  const verify = run(['scripts/ci-mock.js', 'verify']);
  assert.equal(verify.status, 0, verify.stderr || verify.stdout);
  process.stdout.write(verify.stdout);
} finally {
  const stop = run(['scripts/ci-mock.js', 'stop']);
  await rm(directory, { recursive: true, force: true });
  assert.equal(stop.status, 0, stop.stderr || stop.stdout);
}

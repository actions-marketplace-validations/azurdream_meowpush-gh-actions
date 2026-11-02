import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildDistribution } from './build.js';

const temporary = await mkdtemp(join(tmpdir(), 'meowpush-dist-'));

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(join(directory, entry.name), relative)));
    } else {
      assert(
        entry.isFile(),
        `Unexpected non-file in distribution: ${relative}`,
      );
      files.push(relative);
    }
  }
  return files.sort();
}

try {
  await buildDistribution({ outdir: temporary });
  const actualDirectory = resolve('dist');
  const expected = await listFiles(temporary);
  assert.deepEqual(
    await listFiles(actualDirectory),
    expected,
    'Distribution file list is stale. Run npm run build.',
  );
  for (const file of expected) {
    const [actual, fresh] = await Promise.all([
      readFile(join(actualDirectory, file)),
      readFile(join(temporary, file)),
    ]);
    assert(
      actual.equals(fresh),
      `dist/${file} is stale. Run npm run build and include the updated files.`,
    );
  }
  console.log('Distribution matches a fresh build.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}

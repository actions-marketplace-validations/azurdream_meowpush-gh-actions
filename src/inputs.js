export const DEFAULT_ENDPOINT = 'https://send.meowpush.com/';
export const DEFAULT_TIMEOUT_MS = 30_000;
// Node's timer uses a signed 32-bit millisecond delay.
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

export class InputError extends Error {}

function parseJson(text, name) {
  try {
    return JSON.parse(text);
  } catch {
    // JSON parser errors can include snippets of credentials or notification data.
    throw new InputError(`${name} must contain valid JSON.`);
  }
}

function integer(text, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(text)) {
    throw new InputError(`${name} must be an integer of at least ${minimum}.`);
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new InputError(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

/** Read secrets first, before validating anything that could fail. */
export function readCredentials(core) {
  const key = core.getInput('key');
  if (key) core.setSecret(key);
  const keys = core.getInput('keys');
  if (keys) core.setSecret(keys);
  let parsedKeys;
  if (keys) {
    parsedKeys = parseJson(keys, 'keys');
    if (Array.isArray(parsedKeys)) {
      for (const item of parsedKeys) {
        if (typeof item === 'string' && item.trim())
          core.setSecret(item.trim());
      }
    }
  }
  if (Boolean(key) === Boolean(keys)) {
    throw new InputError('Provide exactly one of key or keys.');
  }
  const targets = key ? [key] : parsedKeys;
  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    targets.some((item) => typeof item !== 'string' || !item.trim())
  ) {
    throw new InputError(
      'keys must be a nonempty JSON array of nonempty strings.',
    );
  }
  const normalized = targets.map((item) => item.trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new InputError('keys must not contain duplicates.');
  }
  if (
    normalized.length > 1 &&
    normalized.some((item) => item.startsWith('mpap'))
  ) {
    throw new InputError(
      'An Application Push Key must be the only key in the request.',
    );
  }
  return {
    keys: normalized,
    field: key ? { key: normalized[0] } : { keys: normalized },
  };
}

export function readRequest(core, credentials) {
  const body = core.getInput('body', { trimWhitespace: false });
  if (!body.length) throw new InputError('body is required.');
  const payload = { ...credentials.field, body };
  const strings = [
    'title',
    'subtitle',
    'level',
    'icon',
    'image',
    'url',
    'group',
    'collapse-id',
  ];
  for (const name of strings) {
    const value = core.getInput(name, { trimWhitespace: false });
    if (value !== '')
      payload[name === 'collapse-id' ? 'collapse_id' : name] = value;
  }
  for (const name of ['badge', 'ttl']) {
    const value = core.getInput(name);
    if (value !== '') payload[name] = integer(value, name);
  }

  const data = core.getInput('data');
  if (data) {
    const parsed = parseJson(data, 'data');
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new InputError('data must be a JSON object.');
    }
    if (Object.hasOwn(parsed, 'aps') || Object.hasOwn(parsed, 'mp')) {
      throw new InputError(
        'data must not contain the reserved top-level fields aps or mp.',
      );
    }
  }

  let endpoint;
  try {
    endpoint = new URL(core.getInput('endpoint') || DEFAULT_ENDPOINT);
  } catch {
    throw new InputError('endpoint must be an absolute HTTP or HTTPS URL.');
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new InputError(
      'endpoint must be an HTTP or HTTPS URL without embedded credentials.',
    );
  }
  const timeoutMs = integer(
    core.getInput('timeout') || String(DEFAULT_TIMEOUT_MS),
    'timeout',
    1,
    MAX_TIMEOUT_MS,
  );

  // Keep valid data JSON verbatim: parsing then serializing would round large
  // integers and decimals. All other fields are serialized normally, so data
  // cannot escape its object or override a top-level request field.
  const serialized = JSON.stringify(payload);
  return {
    endpoint: endpoint.href,
    timeoutMs,
    payload: data ? `${serialized.slice(0, -1)},"data":${data}}` : serialized,
    keys: credentials.keys,
  };
}

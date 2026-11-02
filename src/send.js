import { ReadableStream } from 'node:stream/web';

export const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const RESULT_TEXT_FIELDS = [
  'message_id',
  'reason',
  'detail',
  'retry_at',
  'delivery_adapter',
  'delivery_policy',
];

export function emptyOutputs() {
  return {
    success: 'false',
    'notification-id': '',
    accepted: '',
    failed: '',
    results: '[]',
    'http-status': '',
    'error-code': '',
    'error-message': '',
  };
}

export function createRedactor(secrets) {
  const escaped = [...new Set(secrets.filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Also remove recognizable credentials mistakenly echoed by an endpoint,
  // even if they weren't submitted by this Action.
  const pattern = new RegExp(
    [
      ...escaped,
      'mp(?:dv|gp)[0-9a-hjkmnp-tv-z]{16}',
      'mpap[0-9a-hjkmnp-tv-z]{26}',
    ].join('|'),
    'g',
  );
  return (text) => text.replace(pattern, '[REDACTED]');
}

class ResponseSizeError extends Error {}

async function readBody(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        // Don't wait for a remote peer to finish sending an oversized body.
        void reader.cancel().catch(() => {});
        throw new ResponseSizeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  // Decode once so UTF-8 sequences split across network chunks stay intact.
  return Buffer.concat(chunks).toString('utf8');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAggregate(value) {
  if (
    !isObject(value) ||
    typeof value.notification_id !== 'string' ||
    !value.notification_id ||
    !Number.isSafeInteger(value.accepted) ||
    value.accepted < 0 ||
    !Number.isSafeInteger(value.failed) ||
    value.failed < 0 ||
    !Array.isArray(value.results)
  )
    return false;
  let accepted = 0;
  let failed = 0;
  for (const result of value.results) {
    if (
      !isObject(result) ||
      !['accepted', 'failed'].includes(result.status) ||
      !(result.transport === null || typeof result.transport === 'string') ||
      typeof result.key !== 'string' ||
      !result.key ||
      !Array.isArray(result.source_keys) ||
      !result.source_keys.length ||
      result.source_keys.some((key) => typeof key !== 'string' || !key) ||
      RESULT_TEXT_FIELDS.some(
        (name) =>
          result[name] !== undefined && typeof result[name] !== 'string',
      )
    )
      return false;
    if (result.status === 'accepted') accepted++;
    else failed++;
  }
  return accepted === value.accepted && failed === value.failed;
}

function sanitizedResults(results, keys, redact) {
  const indexes = new Map(keys.map((key, index) => [key, index]));
  return results.map((result) => {
    const safe = {
      key_index: indexes.get(result.key) ?? null,
      source_key_indexes: result.source_keys.map(
        (key) => indexes.get(key) ?? null,
      ),
      status: result.status,
      transport: result.transport === null ? null : redact(result.transport),
    };
    for (const name of RESULT_TEXT_FIELDS) {
      if (typeof result[name] === 'string') safe[name] = redact(result[name]);
    }
    return safe;
  });
}

function fail(outputs, code, message) {
  outputs['error-code'] = code;
  outputs['error-message'] = message;
  return outputs;
}

function interpret(response, value, outputs, request, redact) {
  if (isAggregate(value)) {
    outputs['notification-id'] = redact(value.notification_id);
    outputs.accepted = String(value.accepted);
    outputs.failed = String(value.failed);
    outputs.results = JSON.stringify(
      sanitizedResults(value.results, request.keys, redact),
    );
    if (!response.ok) {
      return fail(
        outputs,
        'action_http_error',
        `MeowPush returned HTTP ${response.status}; inspect results for target failures.`,
      );
    }
    if (value.failed > 0) {
      return fail(
        outputs,
        'action_delivery_failed',
        `MeowPush accepted ${value.accepted} result(s) and failed ${value.failed} result(s).`,
      );
    }
    if (value.accepted === 0) {
      return fail(
        outputs,
        'action_no_targets',
        'MeowPush did not accept any notifications because no targets were resolved.',
      );
    }
    outputs.success = 'true';
    return outputs;
  }
  if (
    isObject(value) &&
    isObject(value.error) &&
    typeof value.error.code === 'string' &&
    value.error.code &&
    typeof value.error.message === 'string'
  ) {
    return fail(
      outputs,
      redact(value.error.code),
      redact(value.error.message) || 'MeowPush returned an API error.',
    );
  }
  return response.ok
    ? fail(
        outputs,
        'action_invalid_response',
        'MeowPush returned an invalid notification response.',
      )
    : fail(
        outputs,
        'action_http_error',
        `MeowPush returned HTTP ${response.status} without a valid notification response.`,
      );
}

/** Exactly one request. The timer remains active until the response is read. */
export async function sendNotification(
  request,
  { fetchImpl = globalThis.fetch, redact = createRedactor(request.keys) } = {},
) {
  let outputs = emptyOutputs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const payload = Buffer.from(request.payload);
    const response = await fetchImpl(request.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(payload.byteLength),
        accept: 'application/json',
        'user-agent': 'meowpush-gh-actions/1',
      },
      // Fetch replays string/Buffer bodies after HTTP 421. A one-shot stream
      // has no replayable source, preserving the single-send contract.
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(payload);
          controller.close();
        },
      }),
      duplex: 'half',
      redirect: 'manual',
      signal: controller.signal,
    });
    outputs['http-status'] = String(response.status);
    const text = await readBody(response);
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      // Never expose a gateway body or JSON parser excerpt.
    }
    outputs = interpret(response, value, outputs, request, redact);
    // GitHub budgets outputs in UTF-16. Bound sanitized output too, since
    // replacing very short secrets may expand the original response.
    const outputBytes = Object.values(outputs).reduce(
      (size, value) => size + value.length * 2,
      0,
    );
    if (outputBytes > MAX_OUTPUT_BYTES) throw new ResponseSizeError();
    return outputs;
  } catch (error) {
    if (error instanceof ResponseSizeError) {
      outputs = { ...emptyOutputs(), 'http-status': outputs['http-status'] };
      return fail(
        outputs,
        'action_response_too_large',
        'MeowPush response exceeded the safe response or output size limit.',
      );
    }
    if (controller.signal.aborted) {
      return fail(
        outputs,
        'action_timeout',
        'MeowPush request timed out. Delivery may already have occurred; the request was not retried.',
      );
    }
    return fail(
      outputs,
      'action_network_error',
      'Unable to complete the MeowPush request. Delivery may already have occurred; the request was not retried.',
    );
  } finally {
    clearTimeout(timer);
  }
}

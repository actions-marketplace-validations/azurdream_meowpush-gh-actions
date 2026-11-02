import { InputError, readCredentials, readRequest } from './inputs.js';
import { createRedactor, emptyOutputs, sendNotification } from './send.js';

export async function runAction(core, { fetchImpl = globalThis.fetch } = {}) {
  const secrets = [];
  const inputCore = {
    getInput: (...args) => core.getInput(...args),
    setSecret: (secret) => {
      secrets.push(secret);
      core.setSecret(secret);
    },
  };
  let outputs;
  try {
    const credentials = readCredentials(inputCore);
    const request = readRequest(inputCore, credentials);
    outputs = await sendNotification(request, {
      fetchImpl,
      redact: createRedactor(secrets),
    });
  } catch (error) {
    outputs = emptyOutputs();
    outputs['error-code'] =
      error instanceof InputError
        ? 'action_invalid_input'
        : 'action_internal_error';
    outputs['error-message'] =
      error instanceof InputError
        ? createRedactor(secrets)(error.message)
        : 'Unable to prepare the MeowPush notification.';
  }

  // Outputs must be written even when the step subsequently fails.
  for (const [name, value] of Object.entries(outputs))
    core.setOutput(name, value);
  if (outputs.success === 'true') {
    core.info(`MeowPush: ${outputs.accepted} accepted result(s).`);
  } else {
    core.setFailed(outputs['error-message']);
  }
  return outputs;
}

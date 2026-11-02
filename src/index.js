import { getInput, info, setFailed, setOutput, setSecret } from '@actions/core';
import { runAction } from './action.js';

runAction({ getInput, info, setFailed, setOutput, setSecret }).catch(() => {
  // Avoid printing unexpected exception stacks or environment values.
  setFailed('Unable to write MeowPush Action outputs.');
});

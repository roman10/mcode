import { describe } from 'vitest';
import { createCodexTestSession, describeAgentTaskQueue } from '../helpers';

describe('codex task queue', () => {
  describeAgentTaskQueue('Codex', createCodexTestSession);
});

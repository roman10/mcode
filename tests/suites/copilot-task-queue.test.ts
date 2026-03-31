import { describe } from 'vitest';
import { createCopilotTestSession, describeAgentTaskQueue } from '../helpers';

describe('copilot task queue', () => {
  describeAgentTaskQueue('Copilot', createCopilotTestSession);
});

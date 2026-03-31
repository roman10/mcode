import { describe } from 'vitest';
import { createGeminiTestSession, describeAgentTaskQueue } from '../helpers';

describe('gemini task queue', () => {
  describeAgentTaskQueue('Gemini', createGeminiTestSession);
});

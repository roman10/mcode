-- Add plan_mode_action column to task_queue.
-- When set (JSON: {exitPlanMode: boolean}), the task is a plan mode response:
-- instead of writing the prompt to the idle PTY, the task queue navigates the
-- user-choice menu to "Type here" and types the prompt as feedback.
ALTER TABLE task_queue ADD COLUMN plan_mode_action TEXT;

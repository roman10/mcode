import type { TaskQueue } from '../task-queue';
import { typedHandle } from '../ipc-helpers';

export function registerTaskIpc(taskQueue: TaskQueue): void {
  typedHandle('task:create', (input) => {
    return taskQueue.create(input);
  });

  typedHandle('task:list', (filter) => {
    return taskQueue.list(filter);
  });

  typedHandle('task:update', (taskId, input) => {
    return taskQueue.update(taskId, input);
  });

  typedHandle('task:cancel', (taskId) => {
    taskQueue.cancel(taskId);
  });

  typedHandle('task:reorder', (taskId, direction) => {
    return taskQueue.reorder(taskId, direction);
  });
}

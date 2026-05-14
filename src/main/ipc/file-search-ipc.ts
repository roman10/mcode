import type { FileSearch } from '../file-search';
import { typedHandle } from '../ipc-helpers';

export function registerSearchIpc(fileSearch: FileSearch): void {
  typedHandle('search:start', (request) => {
    return fileSearch.search(request);
  });

  typedHandle('search:cancel', (searchId) => {
    fileSearch.cancel(searchId);
  });
}

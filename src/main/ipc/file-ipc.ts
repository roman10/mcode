import type { FileLister } from '../file-lister';
import { typedHandle } from '../ipc-helpers';

export function registerFileIpc(fileLister: FileLister): void {
  typedHandle('files:list', (cwd) => {
    return fileLister.listFiles(cwd);
  });

  typedHandle('files:read', (cwd, relativePath) => {
    return fileLister.readFile(cwd, relativePath);
  });

  typedHandle('files:write', (cwd, relativePath, content) => {
    return fileLister.writeFile(cwd, relativePath, content);
  });
}

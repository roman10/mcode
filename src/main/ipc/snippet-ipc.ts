import {
  scanSnippets,
  createSnippet,
  createSnippetFromText,
  deleteSnippet,
  openSnippetsFolder,
} from '../snippet-scanner';
import { typedHandle } from '../ipc-helpers';

export function registerSnippetIpc(): void {
  typedHandle('snippets:scan', (cwd) => {
    return scanSnippets(cwd);
  });
  typedHandle('snippets:create', (scope, cwd) => {
    return createSnippet(scope, cwd);
  });
  typedHandle('snippets:create-from-text', (scope, cwd, text) => {
    return createSnippetFromText(scope, cwd, text);
  });
  typedHandle('snippets:delete', (filePath) => {
    return deleteSnippet(filePath);
  });
  typedHandle('snippets:open-folder', (scope, cwd) => {
    return openSnippetsFolder(scope, cwd);
  });
}

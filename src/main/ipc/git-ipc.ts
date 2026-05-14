import type { GitChangesService } from '../git-changes';
import { typedHandle } from '../ipc-helpers';

export function registerGitChangesIpc(gitChangesService: GitChangesService): void {
  typedHandle('git:status', (cwd) => {
    return gitChangesService.getStatus(cwd);
  });

  typedHandle('git:diff-content', (cwd, filePath) => {
    return gitChangesService.getDiffContent(cwd, filePath);
  });

  typedHandle('git:all-statuses', () => {
    return gitChangesService.getAllStatuses();
  });

  typedHandle('git:graph-log', (repoPath, limit, offset) => {
    return gitChangesService.getGraphLog(repoPath, limit, offset);
  });

  typedHandle('git:tracked-repos', () => {
    return gitChangesService.getTrackedRepos();
  });

  typedHandle('git:commit-files', (repoPath, commitHash) => {
    return gitChangesService.getCommitFiles(repoPath, commitHash);
  });

  typedHandle('git:commit-file-diff', (repoPath, commitHash, filePath) => {
    return gitChangesService.getCommitFileDiff(repoPath, commitHash, filePath);
  });

  typedHandle('git:stage-file', (repoRoot, filePath) => {
    return gitChangesService.stageFile(repoRoot, filePath);
  });

  typedHandle('git:unstage-file', (repoRoot, filePath) => {
    return gitChangesService.unstageFile(repoRoot, filePath);
  });

  typedHandle('git:discard-file', (repoRoot, filePath, isUntracked) => {
    return gitChangesService.discardFile(repoRoot, filePath, isUntracked);
  });

  typedHandle('git:stage-all', (repoRoot) => {
    return gitChangesService.stageAll(repoRoot);
  });

  typedHandle('git:unstage-all', (repoRoot) => {
    return gitChangesService.unstageAll(repoRoot);
  });

  typedHandle('git:discard-all', (repoRoot) => {
    return gitChangesService.discardAll(repoRoot);
  });
}

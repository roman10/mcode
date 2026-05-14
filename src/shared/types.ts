/**
 * Barrel for all shared types. Domain-specific types live in `types-*.ts`
 * alongside this file. Consumers can import from `@shared/types` (everything
 * is re-exported below) or from a domain file directly for narrower scope.
 *
 * The renderer-facing IPC bridge surface lives in `mcode-api.ts`.
 */

export * from './types-accounts';
export * from './types-commands';
export * from './types-commits';
export * from './types-devtools';
export * from './types-files';
export * from './types-git';
export * from './types-hooks';
export * from './types-input';
export * from './types-layout';
export * from './types-pty';
export * from './types-quotas';
export * from './types-search';
export * from './types-sessions';
export * from './types-shell';
export * from './types-snippets';
export * from './types-tasks';
export * from './types-todos';
export * from './types-tokens';
export type { MCodeAPI } from './mcode-api';

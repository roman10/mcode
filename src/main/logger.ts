import log from 'electron-log/main';

log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB
log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s}.{ms} [{level}] {text}';

export const logger = {
  debug(module: string, message: string, data?: Record<string, unknown>): void {
    log.debug(`[${module}]`, message, data ?? '');
  },
  info(module: string, message: string, data?: Record<string, unknown>): void {
    log.info(`[${module}]`, message, data ?? '');
  },
  warn(module: string, message: string, data?: Record<string, unknown>): void {
    log.warn(`[${module}]`, message, data ?? '');
  },
  error(module: string, message: string, data?: Record<string, unknown>): void {
    log.error(`[${module}]`, message, data ?? '');
  },
};

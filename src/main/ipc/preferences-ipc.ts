import { typedHandle } from '../ipc-helpers';
import { getPreference, setPreference } from '../preferences';
import type { SleepBlocker } from '../sleep-blocker';

export function registerPreferencesIpc(sleepBlocker: SleepBlocker): void {
  typedHandle('preferences:get', (key) => {
    return getPreference(key);
  });

  typedHandle('preferences:set', (key, value) => {
    setPreference(key, value);
  });

  typedHandle('preferences:get-sleep-status', () => {
    return {
      enabled: sleepBlocker.isEnabled(),
      blocking: sleepBlocker.isBlocking(),
    };
  });

  typedHandle('preferences:set-prevent-sleep', (enabled) => {
    sleepBlocker.setEnabled(enabled);
  });
}

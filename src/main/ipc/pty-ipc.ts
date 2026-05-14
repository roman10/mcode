import type { BrokerClient } from '../pty/broker-client';
import { typedHandle, typedOn } from '../ipc-helpers';

export function registerPtyIpc(brokerClient: BrokerClient): void {
  typedOn('pty:write', (id, data) => {
    brokerClient.write(id, data);
  });

  typedOn('pty:resize', (id, cols, rows) => {
    brokerClient.resize(id, cols, rows);
  });

  typedHandle('pty:kill', (id) => {
    return brokerClient.kill(id);
  });

  typedHandle('pty:replay', (sessionId) => {
    return brokerClient.fetchReplayFromBroker(sessionId);
  });

  typedHandle('pty:replay-since', (sessionId, offset) => {
    return brokerClient.getReplaySince(sessionId, offset);
  });
}

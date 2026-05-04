import type { PtyExitPayload, PtyReplayDelta } from './types';

// ---------------------------------------------------------------------------
// PTY domain IPC channels
// ---------------------------------------------------------------------------

export interface PtyInvokeContract {
  'pty:kill':                           { params: [id: string]; result: void };
  'pty:replay':                         { params: [sessionId: string]; result: string };
  'pty:replay-since':                   { params: [sessionId: string, offset: number]; result: PtyReplayDelta };
}

export interface PtySendContract {
  'pty:write':                          { params: [id: string, data: string] };
  'pty:resize':                         { params: [id: string, cols: number, rows: number] };
}

export interface PtyPushContract {
  'pty:data':                           { params: [sessionId: string, data: string] };
  'pty:exit':                           { params: [sessionId: string, payload: PtyExitPayload] };
}

import type { AcpLiveControls } from './acp-live-controls';
import type { AcpSDKClient } from './acp-sdk-client';

const acpSessions = new Map<string, AcpSDKClient>();
const acpControls = new Map<string, AcpLiveControls>();

export function setAcpConnection(
  sessionId: string,
  connection: AcpSDKClient,
  controls: AcpLiveControls
): void {
  acpSessions.set(sessionId, connection);
  acpControls.set(sessionId, controls);
}

export function getAcpConnection(sessionId: string): AcpSDKClient | undefined {
  return acpSessions.get(sessionId);
}

/** A live ACP session's controls; every started ACP session has them. */
export function requireAcpControls(sessionId: string): AcpLiveControls {
  const controls = acpControls.get(sessionId);
  if (!controls) throw new Error(`No live ACP session ${sessionId}`);
  return controls;
}

export function removeAcpConnection(sessionId: string): void {
  acpSessions.delete(sessionId);
  acpControls.delete(sessionId);
}

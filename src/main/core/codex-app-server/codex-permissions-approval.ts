import type { AcpPermissionOption } from '@shared/acp-types';
import type { FileSystemPath } from './protocol/v2/FileSystemPath';
import type { GrantedPermissionProfile } from './protocol/v2/GrantedPermissionProfile';
import type { PermissionsRequestApprovalParams } from './protocol/v2/PermissionsRequestApprovalParams';
import type { PermissionsRequestApprovalResponse } from './protocol/v2/PermissionsRequestApprovalResponse';

/**
 * Codex asking for access beyond its sandbox (network, paths) through its
 * `request_permissions` tool. Allowing grants exactly what was asked, for the
 * turn or the session; denying grants nothing — the Codex TUI's reply
 * (`tui/src/bottom_pane/approval_overlay.rs`).
 */

const OPTIONS: AcpPermissionOption[] = [
  { optionId: 'turn', name: 'Allow', kind: 'allow_once' },
  { optionId: 'session', name: 'Allow for this session', kind: 'allow_always' },
  { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
];

function describePath(path: FileSystemPath): string {
  switch (path.type) {
    case 'path':
      return path.path;
    case 'glob_pattern':
      return path.pattern;
    case 'special':
      return JSON.stringify(path.value);
  }
}

/**
 * One line per thing asked for: `network access`, `read <path>`, `write <path>`.
 * `entries` supersedes the legacy `read`/`write` lists, and Codex sends both
 * for the same paths, so the lists are read only when there are no entries.
 */
function describeRequest(params: PermissionsRequestApprovalParams): string[] {
  const { network, fileSystem } = params.permissions;
  const lines: string[] = [];
  if (network?.enabled) lines.push('network access');
  if (fileSystem?.entries?.length) {
    for (const entry of fileSystem.entries) {
      lines.push(`${entry.access} ${describePath(entry.path)}`);
    }
  } else {
    for (const path of fileSystem?.read ?? []) lines.push(`read ${path}`);
    for (const path of fileSystem?.write ?? []) lines.push(`write ${path}`);
  }
  if (lines.length === 0) throw new Error('Codex asked for permissions without naming any');
  return lines;
}

/**
 * The card names the tool Codex runs ("Allow Codex to run request_permissions?"),
 * as every permission card names its tool; the lines below it say what access.
 */
const PERMISSIONS_TOOL = 'request_permissions';

export function toPermissionsApprovalCard(params: PermissionsRequestApprovalParams): {
  name: string;
  title: string;
  command: string;
  options: AcpPermissionOption[];
} {
  return {
    name: PERMISSIONS_TOOL,
    title: params.reason ?? 'Codex asks for more access than its sandbox allows.',
    command: describeRequest(params).join('\n'),
    options: OPTIONS,
  };
}

/** The request's nullable fields, as the grant's optional ones. */
function grantAsked(params: PermissionsRequestApprovalParams): GrantedPermissionProfile {
  const { network, fileSystem } = params.permissions;
  return {
    ...(network ? { network } : {}),
    ...(fileSystem ? { fileSystem } : {}),
  };
}

/** The reply for the option picked; it must be one the card offered. */
export function toPermissionsApprovalResponse(
  optionId: string,
  params: PermissionsRequestApprovalParams
): PermissionsRequestApprovalResponse {
  switch (optionId) {
    case 'turn':
    case 'session':
      return { permissions: grantAsked(params), scope: optionId };
    case 'decline':
      return { permissions: {}, scope: 'turn' };
    default:
      throw new Error(`Codex did not offer "${optionId}" for this permissions request`);
  }
}

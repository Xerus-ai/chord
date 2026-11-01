import type { PushError } from '@shared/git';

/** A failed `git push`, typed from what git wrote to stderr. Shared by push and publish. */
export function classifyPushFailure(stderr: string, message: string): PushError {
  if (
    stderr.includes('[rejected]') ||
    stderr.includes('Updates were rejected') ||
    stderr.includes('non-fast-forward')
  ) {
    return { type: 'rejected', message };
  }
  if (
    stderr.includes('Authentication failed') ||
    stderr.includes('authentication failed') ||
    stderr.includes('Permission denied') ||
    stderr.includes('could not read Username')
  ) {
    return { type: 'auth_failed', message };
  }
  if (
    stderr.includes('Could not resolve host') ||
    stderr.includes('could not resolve host') ||
    stderr.includes('Network is unreachable') ||
    stderr.includes('Connection refused') ||
    stderr.includes('Connection timed out') ||
    stderr.includes('unable to connect')
  ) {
    return { type: 'network_error', message };
  }
  if (stderr.includes('hook declined') || stderr.includes('pre-receive hook')) {
    return { type: 'hook_rejected', message };
  }
  if (stderr.includes('No configured push destination') || stderr.includes('no remote')) {
    return { type: 'no_remote', message };
  }
  return { type: 'error', message };
}

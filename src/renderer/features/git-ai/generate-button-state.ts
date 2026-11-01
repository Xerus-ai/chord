import { getAgentDisplayName } from '@shared/agent-display-name';
import type { GitAiAgent, GitAiAgentStatus } from '@shared/git-ai';

export interface GenerateButtonState {
  label: string;
  disabled: boolean;
  /** Shows the spinner: a run is in flight and the button cancels it. */
  busy: boolean;
  title: string;
}

/**
 * The Generate button: it names the chosen agent when that agent can't
 * answer, shows progress while it runs, and is the way to cancel.
 */
export function describeGenerateButton(args: {
  agent: GitAiAgent;
  /** Null while the agent is being checked. */
  status: GitAiAgentStatus | null;
  statusError: string | null;
  generating: boolean;
}): GenerateButtonState {
  const name = getAgentDisplayName(args.agent);
  if (args.generating) {
    return {
      label: 'Cancel',
      disabled: false,
      busy: true,
      title: `Generating with ${name} — click to cancel`,
    };
  }
  // A check that failed is named like an agent that can't answer: the button
  // must not look ready when nothing is known.
  if (args.statusError !== null) {
    return {
      label: `${name} unavailable`,
      disabled: true,
      busy: false,
      title: `Couldn't check ${name}: ${args.statusError}`,
    };
  }
  if (args.status === null) {
    return { label: 'Generate', disabled: true, busy: false, title: `Checking ${name}…` };
  }
  switch (args.status.state) {
    case 'ready':
      return { label: 'Generate', disabled: false, busy: false, title: `Write it with ${name}` };
    case 'not_installed':
      return {
        label: `${name} not installed`,
        disabled: true,
        busy: false,
        title: args.status.message,
      };
    case 'not_signed_in':
      return {
        label: `${name} not signed in`,
        disabled: true,
        busy: false,
        title: args.status.message,
      };
    case 'unavailable':
      return {
        label: `${name} unavailable`,
        disabled: true,
        busy: false,
        title: args.status.message,
      };
  }
}

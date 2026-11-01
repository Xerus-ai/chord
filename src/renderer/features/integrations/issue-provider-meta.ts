import githubLogo from '@/assets/images/github.png';
import jiraLogo from '@/assets/images/jira.png';
import linearLogo from '@/assets/images/Linear.svg';
import type { IssueProviderType } from '@shared/issue-providers';

export const ISSUE_PROVIDER_ORDER: IssueProviderType[] = ['linear', 'github', 'jira'];

export const ISSUE_PROVIDER_META: Record<
  IssueProviderType,
  {
    displayName: string;
    logo: string;
  }
> = {
  linear: { displayName: 'Linear', logo: linearLogo },
  github: { displayName: 'GitHub', logo: githubLogo },
  jira: { displayName: 'Jira', logo: jiraLogo },
};

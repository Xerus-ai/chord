export interface FeedbackGithubUser {
  login?: string;
  name?: string;
  html_url?: string;
  email?: string;
}

interface BuildFeedbackContentOptions {
  feedback: string;
  contactEmail: string;
  githubUser?: FeedbackGithubUser | null;
  appVersion?: string | null;
}

export function buildFeedbackContent({
  feedback,
  contactEmail,
  githubUser,
  appVersion,
}: BuildFeedbackContentOptions): string {
  const trimmedFeedback = feedback.trim();
  const trimmedContact = contactEmail.trim();
  const metadataLines: string[] = [];

  if (trimmedContact) {
    metadataLines.push(`Contact: ${trimmedContact}`);
  }

  const githubLogin = githubUser?.login?.trim();
  const githubName = githubUser?.name?.trim();
  if (githubLogin || githubName) {
    const parts: string[] = [];
    if (githubName && githubLogin) {
      parts.push(`${githubName} (@${githubLogin})`);
    } else if (githubName) {
      parts.push(githubName);
    } else if (githubLogin) {
      parts.push(`@${githubLogin}`);
    }
    metadataLines.push(`GitHub: ${parts.join(' ')}`);
  }

  const trimmedAppVersion = appVersion?.trim();
  if (trimmedAppVersion) {
    metadataLines.push(`Chord Version: ${trimmedAppVersion}`);
  }

  return [trimmedFeedback, metadataLines.join('\n')].filter(Boolean).join('\n\n');
}

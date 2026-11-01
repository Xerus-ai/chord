import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Separator } from '@renderer/lib/ui/separator';
import { RepoFilesSection } from './repo-files-section';
import { RepoGeneralSection } from './repo-general-section';
import { RepoGitAiSection } from './repo-git-ai-section';
import { RepoManageSection } from './repo-manage-section';
import { RepoRunSection } from './repo-run-section';
import { RepoTrustSection } from './repo-trust-section';
import { useRepoSettings } from './use-repo-settings';

/** A section the page can be opened at. */
export type RepoSettingsSection = 'run';

function Section({
  title,
  focused = false,
  children,
}: {
  title: string;
  /** The page was opened at this section: it scrolls into view. */
  focused?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start' });
  }, [focused]);
  return (
    <section
      ref={ref}
      aria-label={title}
      className="flex flex-col gap-4 border-t border-border-subtle pt-6"
    >
      <h2 className="text-body tracking-body font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Settings › Repository › <repo>. Every value says where it came from (Team
 * file / Just me / Default), read where a new lane reads it — the team file
 * at the repository's base branch.
 */
export function RepoSettingsPage({
  repoId,
  section,
  onBack,
}: {
  repoId: string;
  section?: RepoSettingsSection;
  onBack: () => void;
}) {
  const repo = useRepoSettings(repoId);
  const { data, error } = repo.settings;

  return (
    // Same heading tier, width and gutter as the tab pages (`SettingsPage`):
    // the page is a peer reached from the rail's Repositories group, so it
    // carries no back link of its own (devstation-xufp).
    <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-10">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-display tracking-display">{data?.repo.alias ?? 'Repository'}</h1>
            {data && (
              <p className="font-mono text-tiny tracking-tiny text-text-passive">
                {data.repo.path}
              </p>
            )}
          </div>
          <Separator />
        </div>

        {error ? (
          <p className="text-tiny tracking-tiny text-status-err">
            Could not load this repository: {error.message}
          </p>
        ) : !data ? (
          <p className="text-tiny tracking-tiny text-text-passive">Loading…</p>
        ) : (
          <>
            {data.configError && (
              <Notice>
                {data.configError} Lanes of this repository fail setup until the file is fixed
                {data.baseRef ? ` at ${data.baseRef}` : ''}.
              </Notice>
            )}
            {data.teamFile.writeBlocked !== null ? (
              <Notice>{data.teamFile.writeBlocked}</Notice>
            ) : data.teamFile.state === 'differs' ? (
              <Notice>
                Your main checkout&apos;s <code className="font-mono">.chord.json</code> is not the
                one at <code className="font-mono">{data.baseRef}</code>. New lanes use{' '}
                {data.baseRef}&apos;s until your change is committed and reaches it.
              </Notice>
            ) : null}
            <Section title="General">
              <RepoGeneralSection data={data} writes={repo} />
            </Section>
            <Section title="Run & test" focused={section === 'run'}>
              <RepoRunSection data={data} repo={repo} />
            </Section>
            <Section title="Files to copy">
              <RepoFilesSection data={data} writes={repo} />
            </Section>
            <Section title="Git AI">
              <RepoGitAiSection repoId={repoId} repo={repo} />
            </Section>
          </>
        )}
        <Section title="Trust">
          <RepoTrustSection repo={repo} />
        </Section>
        <Section title="Manage">
          <RepoManageSection repoId={repoId} onRemoved={onBack} />
        </Section>
      </div>
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-border-subtle bg-surface-raised px-3 py-2">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warn" />
      <p className="text-tiny tracking-tiny text-text">{children}</p>
    </div>
  );
}

import { ChordMark } from '@renderer/lib/components/chord-mark';

export function HomeTitlebar() {
  return null;
}

export function HomeMainPanel() {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface text-text">
      <div className="container mx-auto flex min-h-full max-w-6xl flex-1 flex-col justify-center px-8 py-8">
        <div className="mb-3 text-center">
          <div className="mb-3 flex items-center justify-center">
            <ChordMark className="h-16 w-16" />
          </div>
          <p className="whitespace-nowrap text-tiny tracking-tiny text-text-muted">
            Agentic Development Environment
          </p>
        </div>
      </div>
    </div>
  );
}

export const homeView = {
  TitlebarSlot: HomeTitlebar,
  MainPanel: HomeMainPanel,
};

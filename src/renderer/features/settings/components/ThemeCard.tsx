import { Monitor, Moon, Sun } from 'lucide-react';
import React from 'react';
import type { Theme } from '@shared/app-settings';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { captureTelemetry } from '@renderer/utils/telemetryClient';

const ThemeCard: React.FC = () => {
  const { theme, setTheme } = useTheme();

  const handleSetTheme = (next: Theme) => {
    if (theme !== next) {
      captureTelemetry('setting_changed', { setting: 'theme' });
    }
    setTheme(next);
  };

  const buttonBase =
    'flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border px-2 py-2.5 text-body tracking-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selected-border focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:px-3';
  const activeClass = 'bg-surface-inset';
  const inactiveClass = 'border-border/60 bg-surface text-text-muted hover:bg-surface-raised';

  // The section title ("Color mode") comes from the card registry, like every
  // other section; the card only draws the three choices.
  return (
    <div className="grid gap-3 py-3.5 text-body tracking-body">
      <div className="text-tiny tracking-tiny text-text-passive">Choose how Chord looks.</div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2">
        <button
          type="button"
          onClick={() => handleSetTheme(null)}
          className={`${buttonBase} ${theme === null ? activeClass : inactiveClass}`}
          aria-pressed={theme === null}
          aria-label="Set theme to system preference"
        >
          <Monitor className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-center">System</span>
        </button>
        <button
          type="button"
          onClick={() => handleSetTheme('chord-light')}
          className={`${buttonBase} ${theme === 'chord-light' ? activeClass : inactiveClass}`}
          aria-pressed={theme === 'chord-light'}
          aria-label="Set theme to Chord Light"
        >
          <Sun className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-center">Light</span>
        </button>
        <button
          type="button"
          onClick={() => handleSetTheme('chord-dark')}
          className={`${buttonBase} ${theme === 'chord-dark' ? activeClass : inactiveClass}`}
          aria-pressed={theme === 'chord-dark'}
          aria-label="Set theme to Chord Dark"
        >
          <Moon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-center">Dark</span>
        </button>
      </div>
    </div>
  );
};

export default ThemeCard;

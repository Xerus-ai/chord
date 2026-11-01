import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Theme } from '@shared/app-settings';
import { rpc } from '@renderer/lib/ipc';
import { applyThemeToAll } from '@renderer/lib/pty/pty';

type EffectiveTheme = 'chord-dark' | 'chord-light';

const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function subscribeSystemTheme(cb: () => void) {
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
}

function getSystemSnapshot(): EffectiveTheme {
  return mq?.matches ? 'chord-dark' : 'chord-light';
}

function applyTheme(effective: EffectiveTheme) {
  const root = document.documentElement;
  root.classList.remove('chord-light', 'chord-dark');
  root.classList.add(effective);
  applyThemeToAll();
  // The OS window controls are painted by main over our header rail.
  void rpc.app.setWindowChromeTheme(effective === 'chord-dark' ? 'dark' : 'light');
}

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  effectiveTheme: EffectiveTheme;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(null);
  const systemPref = useSyncExternalStore(subscribeSystemTheme, getSystemSnapshot);

  const effectiveTheme: EffectiveTheme = useMemo(() => theme ?? systemPref, [theme, systemPref]);

  useEffect(() => {
    let cancelled = false;
    void rpc.appSettings.getWithMeta('theme').then((meta) => {
      if (!cancelled) setThemeState((meta.value ?? null) as Theme);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    applyTheme(effectiveTheme);
  }, [effectiveTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    void rpc.appSettings.update('theme', newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(effectiveTheme === 'chord-dark' ? 'chord-light' : 'chord-dark');
  }, [effectiveTheme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

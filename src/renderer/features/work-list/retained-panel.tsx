import { createContext, useContext } from 'react';

interface RetainedPanelState {
  active: boolean;
  focused: boolean;
}

const RetainedPanelContext = createContext<RetainedPanelState>({ active: true, focused: true });

/**
 * Keeps a tab body mounted while another tab is shown, hidden with the
 * `hidden` class, so scroll position, streaming state, and a terminal's
 * buffer survive a tab switch instead of being rebuilt.
 */
export function RetainedPanel({
  active,
  focused = true,
  children,
}: {
  active: boolean;
  /** Whether the pane holding this panel is the focused one. */
  focused?: boolean;
  children: React.ReactNode;
}) {
  return (
    <RetainedPanelContext.Provider value={{ active, focused }}>
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${active ? '' : 'hidden'}`}
      >
        {children}
      </div>
    </RetainedPanelContext.Provider>
  );
}

/**
 * Whether the enclosing retained panel is the visible one. A hidden subtree
 * has zero size, so anything that measures layout — xterm's `fit()`, a
 * virtualizer's row heights — must redo it when this flips back to true.
 * Outside a `RetainedPanel` the content is never hidden, so it reads true.
 */
export function useRetainedPanelActive(): boolean {
  return useContext(RetainedPanelContext).active;
}

/**
 * Whether the enclosing retained panel sits in the focused pane. Outside a
 * `RetainedPanel` there is only one surface, so it reads true.
 */
export function useRetainedPanelFocused(): boolean {
  return useContext(RetainedPanelContext).focused;
}

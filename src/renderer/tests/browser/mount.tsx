import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Mounts React trees into the browser test page, each with its own query client, and takes
 * them all down again: the setup browser suites otherwise copy into every file.
 */
const mounted: { root: Root; host: HTMLDivElement }[] = [];

/**
 * Renders `node` synchronously into a fresh element on the page and returns that element; a
 * test that needs state to outlive one mount passes its own query client.
 */
export function mount(node: ReactNode, client: QueryClient = new QueryClient()): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  mounted.push({ root, host });
  return host;
}

/** Unmounts and removes every tree `mount` rendered (an afterEach, or mid-test). */
export function unmountAll(): void {
  for (const { root, host } of mounted.splice(0)) {
    root.unmount();
    host.remove();
  }
}

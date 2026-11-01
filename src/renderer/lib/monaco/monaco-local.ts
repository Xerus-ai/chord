import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

let configured = false;

/**
 * Points `@monaco-editor/react`'s loader at the Monaco bundled with the app.
 * Its default fetches Monaco's AMD loader from a CDN, which the packaged
 * renderer's CSP (`script-src 'self'`, main/app/protocol.ts) refuses — so a
 * built app never had an editor: files, diffs and Edit mode rendered blank.
 * The workers are bundled too, and start from same-origin `blob:` URLs the
 * CSP's `worker-src 'self' blob:` admits. Idempotent; runs before the pools
 * first load Monaco.
 */
export function configureBundledMonaco(): void {
  if (configured) return;
  configured = true;
  globalThis.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case 'json':
          return new JsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker();
        case 'typescript':
        case 'javascript':
          return new TsWorker();
        default:
          return new EditorWorker();
      }
    },
  };
  loader.config({ monaco });
}

import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import type * as esbuild from 'esbuild';
import { createBundleInputsPlugin } from './bundle-inputs-plugin';

/**
 * Bare imports a prototype may use, and the global the vendored runtime
 * (`src/artifact-runtime/runtime-entry.ts`) exposes them under. The component
 * is compiled against those globals instead of inlining its own React, so one
 * React instance exists in the frame and hooks work. Anything not in this
 * table is bundled from the prototype's own tree — or fails to resolve, which
 * is reported as a build error rather than left to break at runtime.
 */
const RUNTIME_GLOBALS: Record<string, string> = {
  react: 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOMClient',
  'react/jsx-runtime': '_jsx_runtime',
  'react/jsx-dev-runtime': '_jsx_runtime',
  recharts: 'Recharts',
  'chord-components': 'ChordComponents',
};

const GLOBALS_NAMESPACE = 'chord-runtime-global';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

const runtimeGlobalsPlugin: esbuild.Plugin = {
  name: 'chord-runtime-globals',
  setup(build) {
    const filter = new RegExp(
      `^(${Object.keys(RUNTIME_GLOBALS)
        .map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
        .join('|')})$`
    );
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: GLOBALS_NAMESPACE }));
    build.onLoad({ filter: /.*/, namespace: GLOBALS_NAMESPACE }, (args) => ({
      contents: `module.exports = window[${JSON.stringify(RUNTIME_GLOBALS[args.path])}];`,
      loader: 'js',
    }));
  },
};

/**
 * The entry component's source comes from `source` (a stored version) in
 * place of the file on disk. The entry stays in esbuild's `file` namespace
 * under its real path — only its bytes are substituted — so its relative
 * imports resolve against its directory as usual, and its source stamps name
 * it by that path like every other file (see `absWorkingDir` below).
 */
function prototypeEntrySourcePlugin(entryPath: string, source: string): esbuild.Plugin {
  return {
    name: 'chord-prototype-entry-source',
    setup(build) {
      build.onLoad(
        { filter: new RegExp(`^${escapeRegExp(entryPath)}$`), namespace: 'file' },
        () => ({
          contents: source,
          loader: 'tsx',
          resolveDir: dirname(entryPath),
        })
      );
    },
  };
}

/**
 * esbuild is loaded on first use, not at startup: its module reads
 * ESBUILD_BINARY_PATH when it is evaluated, and the bundler hoists a static
 * import above the startup code that sets it (esbuild-binary-path.ts).
 */
async function loadEsbuild(): Promise<typeof esbuild> {
  return import('esbuild');
}

/** Id of the mount node the page document provides. */
export const PAGE_MOUNT_ID = 'chord-root';

/**
 * Defence in depth: the frame CSP never
 * grants 'unsafe-eval', so a bundle that reaches for it would fail at runtime
 * with an opaque CSP error. Refusing it at build time names the cause.
 */
function assertNoRuntimeEval(bundle: string): void {
  if (/\beval\s*\(/.test(bundle) || /\bnew\s+Function\s*\(/.test(bundle)) {
    throw new Error(
      "Prototype bundle contains eval/new Function, which the page sandbox forbids ('unsafe-eval' is never granted)."
    );
  }
}

export interface PrototypeBundle {
  code: string;
  /** Real paths of every file the build read. */
  inputs: string[];
}

export interface BundlePrototypeArgs {
  entryPath: string;
  /** Directories imports may resolve into; see createBundleInputsPlugin. */
  allowedRoots: string[];
  /** Entry source to compile instead of reading `entryPath`. */
  source?: string;
}

/**
 * Bundles a `.tsx`/`.jsx` prototype entry into one browser IIFE that mounts
 * its default export into `#chord-root`. Errors are thrown with esbuild's
 * formatted messages so the host can show them as an error state.
 *
 * Source stamps (bead devstation-975 fix 5): compiled with `jsxDev`, so every
 * JSX element becomes a `jsxDEV(type, props, key, isStatic, { fileName,
 * lineNumber, columnNumber })` call and the runtime's `jsxDEV`
 * (src/artifact-runtime/jsx-source-stamps.ts) puts that on each host
 * element as `data-chord-src`. `absWorkingDir` is the repository root, so
 * `fileName` is repository-relative and no machine path reaches the bundle or
 * the published view.
 */
export async function bundlePrototype(args: BundlePrototypeArgs): Promise<PrototypeBundle> {
  const source = args.source ?? readFileSync(args.entryPath, 'utf-8');
  if (!source.trim()) throw new Error('Prototype entry file is empty');
  const [sourceRoot] = args.allowedRoots;
  if (!sourceRoot) throw new Error('A prototype needs at least one allowed root');

  const stub = [
    `import Component from ${JSON.stringify(args.entryPath)};`,
    `import { createRoot } from "react-dom/client";`,
    `import { createElement } from "react";`,
    `const mount = document.getElementById(${JSON.stringify(PAGE_MOUNT_ID)});`,
    `if (!mount) throw new Error("Page document has no mount node");`,
    `createRoot(mount).render(createElement(Component));`,
  ].join('\n');

  const collector = createBundleInputsPlugin(args.allowedRoots);
  const esbuildModule = await loadEsbuild();
  let result: esbuild.BuildResult<{ write: false }>;
  try {
    result = await esbuildModule.build({
      stdin: { contents: stub, resolveDir: dirname(args.entryPath), loader: 'ts' },
      absWorkingDir: sourceRoot,
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      jsxDev: true,
      minify: true,
      legalComments: 'none',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [
        runtimeGlobalsPlugin,
        ...(args.source === undefined ? [] : [prototypeEntrySourcePlugin(args.entryPath, source)]),
        collector.plugin,
      ],
      logLevel: 'silent',
    });
  } catch (error) {
    const failure = error as { errors?: esbuild.Message[] };
    if (failure.errors && failure.errors.length > 0) {
      const formatted = await esbuildModule.formatMessages(failure.errors, { kind: 'error' });
      throw new Error(formatted.join('\n').trim());
    }
    throw error;
  }

  const bundle = result.outputFiles[0]?.text ?? '';
  if (!bundle.trim()) throw new Error('Prototype build produced an empty bundle');
  assertNoRuntimeEval(bundle);
  // A stored version's entry is not read from disk, so it is not an input.
  const entryReal = realpathSync.native(args.entryPath);
  const inputs = [...collector.inputs].filter(
    (path) => args.source === undefined || path !== entryReal
  );
  return { code: bundle, inputs };
}

import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type * as esbuild from 'esbuild';
import { isPathInside } from './path-containment';

export interface BundleInputsCollector {
  plugin: esbuild.Plugin;
  /** Every file the build read, as real paths — the cache key for the bundle. */
  inputs: Set<string>;
}

interface ResolvePassthrough {
  chordInputsPass?: boolean;
  /** mdx-bundler's own entry: the source we handed it, never a file on disk. */
  inMemory?: boolean;
}

/**
 * Two jobs in one `onResolve`, for both the MDX and the prototype bundler:
 *
 * 1. Containment. Only the entry path is otherwise checked; esbuild would
 *    happily follow `import c from 'C:/Users/x/.credentials.json'` or a
 *    `../../` chain and inline the bytes into the bundle. Every resolved file
 *    is realpath'd (so a symlink cannot stand in for the target) and must sit
 *    under one of `allowedRoots`, or the build fails with a named error.
 * 2. Input tracking. The set of files actually read is what the prepare cache
 *    keys on, so editing an imported sibling rebuilds the page — not only
 *    edits to the entry file.
 *
 * Must be registered FIRST: esbuild stops at the first `onResolve` that
 * answers, so a resolver ahead of this one (mdx-bundler's node-resolve and
 * in-memory plugins) would hand esbuild a path this never saw. `build.resolve`
 * re-enters every later plugin, so frame globals (`react`, `recharts`) still
 * land in their namespace and never reach the filesystem check, and
 * mdx-bundler's in-memory entry — the source this process supplied — is
 * passed through as the one path that has no file behind it.
 */
export function createBundleInputsPlugin(allowedRoots: string[]): BundleInputsCollector {
  const inputs = new Set<string>();
  const plugin: esbuild.Plugin = {
    name: 'chord-bundle-inputs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        // `build.resolve` re-enters every onResolve, including this one.
        if ((args.pluginData as ResolvePassthrough | undefined)?.chordInputsPass) return undefined;
        const resolved = await build.resolve(args.path, {
          kind: args.kind,
          importer: args.importer,
          namespace: args.namespace,
          resolveDir: args.resolveDir,
          pluginData: { chordInputsPass: true } satisfies ResolvePassthrough,
        });
        if (resolved.errors.length > 0) return { errors: resolved.errors };
        if (resolved.external || resolved.namespace !== 'file' || !isAbsolute(resolved.path)) {
          return resolved;
        }
        if ((resolved.pluginData as ResolvePassthrough | undefined)?.inMemory) return resolved;
        const realPath = realpathSync.native(resolved.path);
        if (!allowedRoots.some((root) => isPathInside(root, realPath))) {
          return {
            errors: [
              {
                text: `Import "${args.path}" resolves outside the work item repository and cannot be bundled into a page`,
              },
            ],
          };
        }
        inputs.add(realPath);
        return resolved;
      });
    },
  };
  return { plugin, inputs };
}

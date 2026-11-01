import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/**
 * Loads everything `bundleMdx` loads on its first call, for suites to run in a
 * `beforeAll` with a budget of its own. Under the full suite's worker pool
 * that one-time load took the first bundling test past its 30 s budget while
 * the bundling itself takes well under a second (devstation-9y5).
 *
 * The mdx-bundler entry is the small part (112 ms on an idle machine):
 * `bundleMDX` itself imports @mdx-js/esbuild, remark-frontmatter and
 * remark-mdx-frontmatter when called (mdx-bundler dist/index.js, 2346 ms idle),
 * so those are loaded here too, resolved from mdx-bundler as it resolves them.
 */
export async function preloadMdxBundler(): Promise<void> {
  await import('mdx-bundler');
  const fromBundler = createRequire(createRequire(import.meta.url).resolve('mdx-bundler'));
  await Promise.all(
    ['@mdx-js/esbuild', 'remark-frontmatter', 'remark-mdx-frontmatter'].map(
      (name) => import(pathToFileURL(fromBundler.resolve(name)).href)
    )
  );
}

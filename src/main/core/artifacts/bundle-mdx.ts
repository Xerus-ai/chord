import { readFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { createBundleInputsPlugin } from '@main/core/artifact-pages/bundle-inputs-plugin';

const RECHARTS_EXPORTS = [
  'LineChart',
  'Line',
  'BarChart',
  'Bar',
  'PieChart',
  'Pie',
  'Cell',
  'AreaChart',
  'Area',
  'XAxis',
  'YAxis',
  'CartesianGrid',
  'Tooltip',
  'Legend',
  'ResponsiveContainer',
  'RadarChart',
  'Radar',
  'PolarGrid',
  'PolarAngleAxis',
  'PolarRadiusAxis',
  'ScatterChart',
  'Scatter',
  'ComposedChart',
  'Treemap',
  'Funnel',
  'FunnelChart',
];

export interface MdxBundle {
  /** mdx-bundler's function body; wrapped for the frame by render-page-document. */
  code: string;
  /** Real paths of every file the build read. */
  inputs: string[];
}

export interface BundleMdxArgs {
  /** The `.mdx` file; relative imports resolve against its directory. */
  filePath: string;
  /** Directories imports may resolve into; see createBundleInputsPlugin. */
  allowedRoots: string[];
  /** Source to compile instead of reading `filePath` (a stored version). */
  source?: string;
}

/**
 * mdx-bundler compiles the source under a throwaway entry name in the file's
 * directory, and MDX's `development` output names that in every element's
 * `fileName`. The real file, relative to the repository root, is put in its
 * place — so a stamp never carries a machine path, and names the artifact's
 * own file the way a prototype's stamps name theirs.
 */
const MDX_BUNDLER_ENTRY_LITERAL = /"[^"]*_mdx_bundler_entry_point-[0-9a-f-]{36}\.mdx"/g;

function nameMdxEntryInStamps(code: string, relativePath: string): string {
  const renamed = code.replace(MDX_BUNDLER_ENTRY_LITERAL, JSON.stringify(relativePath));
  if (/fileName:\s*"[^"]*_mdx_bundler_entry_point/.test(renamed)) {
    throw new Error('MDX source stamps still name the bundler entry after renaming');
  }
  return renamed;
}

/**
 * Source stamps (bead devstation-975 fix 5): MDX compiles in `development`
 * mode, whose `jsxDEV` calls carry each element's position in the `.mdx`
 * file — markdown-generated and JSX-written elements alike — and imported
 * `.tsx` components are compiled with `jsxDev` by the same esbuild build.
 * The runtime's `jsxDEV` (src/artifact-runtime/jsx-source-stamps.ts) stamps
 * host elements with them. `absWorkingDir` is the repository root, so the
 * component paths are repository-relative like the entry's.
 */
export async function bundleMdx(args: BundleMdxArgs): Promise<MdxBundle> {
  // Loaded on first use: mdx-bundler requires esbuild, whose module reads
  // ESBUILD_BINARY_PATH at evaluation time, and a static import would be
  // hoisted above the startup code that sets it (esbuild-binary-path.ts).
  const { bundleMDX } = await import('mdx-bundler');
  const source = args.source ?? readFileSync(args.filePath, 'utf-8');

  if (!source.trim()) {
    throw new Error('MDX file is empty');
  }
  const [sourceRoot] = args.allowedRoots;
  if (!sourceRoot) throw new Error('An MDX page needs at least one allowed root');

  const collector = createBundleInputsPlugin(args.allowedRoots);
  const result = await bundleMDX({
    source,
    cwd: dirname(args.filePath),
    globals: {
      recharts: { varName: 'Recharts', namedExports: RECHARTS_EXPORTS },
      'chord-components': {
        varName: 'ChordComponents',
        namedExports: ['InteractiveTable', 'MermaidDiagram', 'CodeBlock', 'Callout'],
      },
      'react/jsx-dev-runtime': { varName: '_jsx_runtime', namedExports: ['jsxDEV', 'Fragment'] },
    },
    mdxOptions: (options) => ({ ...options, development: true }),
    esbuildOptions: (options) => ({
      ...options,
      absWorkingDir: sourceRoot,
      jsxDev: true,
      external: ['recharts', 'chord-components', ...(options.external ?? [])],
      // First, ahead of mdx-bundler's resolvers: see createBundleInputsPlugin.
      plugins: [collector.plugin, ...(options.plugins ?? [])],
    }),
  });

  if (result.errors.length > 0) {
    throw new Error(`MDX bundling errors:\n${result.errors.map((e) => e.text).join('\n')}`);
  }

  const relativePath = relative(sourceRoot, args.filePath).split('\\').join('/');
  const inputs =
    args.source === undefined ? [args.filePath, ...collector.inputs] : [...collector.inputs];
  return { code: nameMdxEntryInStamps(result.code, relativePath), inputs };
}

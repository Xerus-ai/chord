import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as Recharts from 'recharts';
import * as ChordComponents from './components';
import { jsxRuntimeWithSourceStamps } from './jsx-source-stamps';

/**
 * The vendored runtime every MDX component and prototype page runs against.
 * Built once at app build time into `out/artifact-runtime/runtime.js` and
 * served over `chord-artifact://`, so compiled bundles stay small and share a
 * single React instance. The global names match what `mdx-bundler` emits
 * (`React`, `ReactDOM`, `_jsx_runtime`, plus the `globals` map in
 * `main/core/artifacts/bundle-mdx.ts`) and what `bundle-prototype.ts` aliases.
 * Bundles are compiled with `jsxDev`, so `_jsx_runtime` carries the `jsxDEV`
 * that stamps host elements with their source location (jsx-source-stamps.ts).
 */
Object.assign(window, {
  React,
  ReactDOM,
  ReactDOMClient,
  _jsx_runtime: jsxRuntimeWithSourceStamps,
  Recharts,
  ChordComponents,
});

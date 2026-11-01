import { describe, expect, it } from 'vitest';
import { artifactPageCsp } from './page-response-headers';
import {
  renderComponentPageDocument,
  renderHtmlPageDocument,
  wrapMdxBundleAsPageScript,
} from './render-page-document';

describe('artifactPageCsp', () => {
  it("is the plan's sandbox policy, pinned to the page's own origin", () => {
    const csp = artifactPageCsp('p1');
    const directives = csp.split('; ');
    expect(directives).toContain('sandbox allow-scripts');
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain("script-src 'unsafe-inline' chord-artifact://p1");
    expect(directives).toContain("style-src 'unsafe-inline' chord-artifact://p1");
    expect(directives).toContain('img-src data: blob: chord-artifact://p1');
    expect(directives).toContain('font-src data: chord-artifact://p1');
    expect(directives).toContain("connect-src 'none'");
    expect(directives).toContain("form-action 'none'");
    expect(directives).toContain("base-uri 'none'");
    expect(csp).not.toContain('allow-same-origin');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/https?:/);
  });

  it('closes every source for a response that belongs to no page', () => {
    const directives = artifactPageCsp(null).split('; ');
    expect(directives).toContain("script-src 'none'");
    expect(directives).toContain("style-src 'none'");
    expect(directives).toContain("img-src 'none'");
    expect(directives).toContain('sandbox allow-scripts');
  });
});

describe('renderHtmlPageDocument', () => {
  it('injects the token sheet and bridge at the top of an existing head', () => {
    const html = renderHtmlPageDocument(
      'p1',
      '<html><head><meta charset="utf-8"></head><body>x</body></html>'
    );
    const head = html.slice(html.indexOf('<head>') + 6);
    expect(
      head.startsWith('<link rel="stylesheet" href="chord-artifact://p1/__chord/tokens.css">')
    ).toBe(true);
    expect(html).toContain('<script src="chord-artifact://p1/__chord/chord-page.js"></script>');
    expect(html).toContain('<meta charset="utf-8">');
  });

  it('gives a headless document a head, and a bare fragment a whole document', () => {
    expect(renderHtmlPageDocument('p1', '<html><body>x</body></html>')).toMatch(
      /^<html><head><link rel="stylesheet"/
    );
    const fragment = renderHtmlPageDocument('p1', '<h1>hello</h1>');
    expect(fragment).toMatch(/^<!doctype html>/);
    expect(fragment).toContain('<body><h1>hello</h1></body>');
  });

  it('skips a <head> that only appears inside a comment', () => {
    const html = renderHtmlPageDocument(
      'p1',
      '<!-- <head> old --><html><head><title>t</title></head><body>x</body></html>'
    );
    expect(html.indexOf('__chord/tokens.css')).toBeGreaterThan(html.indexOf('-->'));
    expect(html.indexOf('__chord/tokens.css')).toBeLessThan(html.indexOf('<title>'));
    expect(html.startsWith('<!-- <head> old -->')).toBe(true);
  });
});

describe('renderComponentPageDocument', () => {
  it('loads runtime then bundle as module scripts and provides the mount node', () => {
    const html = renderComponentPageDocument('p2', 'prototype');
    expect(html).toContain('<div id="chord-root"></div>');
    const runtimeAt = html.indexOf('__chord/runtime.js');
    const bundleAt = html.indexOf('__chord/bundle.js');
    expect(runtimeAt).toBeGreaterThan(0);
    expect(bundleAt).toBeGreaterThan(runtimeAt);
    expect(html).toContain('<script type="module" src="chord-artifact://p2/__chord/runtime.js">');
    expect(html).not.toContain('srcdoc');
  });
});

describe('wrapMdxBundleAsPageScript', () => {
  it('binds the mdx-bundler globals from the runtime and mounts the default export', () => {
    const script = wrapMdxBundleAsPageScript(
      'var Component={default:function(){}};return Component;'
    );
    expect(script).toContain('(function(React,ReactDOM,_jsx_runtime,Recharts,ChordComponents){');
    expect(script).toContain(
      'window.React,window.ReactDOM,window._jsx_runtime,window.Recharts,window.ChordComponents'
    );
    expect(script).toContain(
      'createRoot(mount).render(window.React.createElement(exportsObject.default))'
    );
    expect(script).not.toContain('new Function');
  });
});

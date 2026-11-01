import { dirname } from 'node:path';
import type { DefaultTreeAdapterMap } from 'parse5';
import { classifyReference, type PageAssetReader } from './page-snapshot-assets';
import { escapeAttributeValue, inlineScriptTag, inlineStyleTag } from './page-snapshot-markup';

type ParsedNode = DefaultTreeAdapterMap['node'];
type ParsedElement = DefaultTreeAdapterMap['element'];

interface SourceEdit {
  start: number;
  end: number;
  text: string;
}

/** Elements whose `src` names a file the page shows. */
const MEDIA_SRC_TAGS = new Set(['img', 'source', 'video', 'audio', 'track', 'input']);

function isElement(node: ParsedNode): node is ParsedElement {
  return 'tagName' in node;
}

function collectElements(root: ParsedNode): ParsedElement[] {
  const found: ParsedElement[] = [];
  const visit = (node: ParsedNode): void => {
    if (isElement(node)) found.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(root);
  return found;
}

function attribute(element: ParsedElement, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

function hasToken(value: string | undefined, token: string): boolean {
  return (value ?? '').toLowerCase().split(/\s+/).includes(token);
}

/** Every attribute but the named ones, re-serialised. */
function keptAttributes(element: ParsedElement, drop: string[]): string {
  return element.attrs
    .filter((attr) => !drop.includes(attr.name))
    .map((attr) => ` ${attr.name}="${escapeAttributeValue(attr.value)}"`)
    .join('');
}

function applyEdits(source: string, edits: SourceEdit[]): string {
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

/**
 * Rewrites a web page so it needs nothing but itself (design 2026-09-24 §9
 * "View document format"): local stylesheets become `<style>` (with their own
 * `url()`s inlined against the sheet's directory), local scripts become inline
 * scripts, and local images and media become `data:` URIs. Every other byte
 * of the author's document is kept. A deferred script is moved to the end of
 * the body, where an inline script runs at the same point a deferred one did.
 */
export async function inlineWebPageAssets(
  authored: string,
  pageFilePath: string,
  assets: PageAssetReader
): Promise<string> {
  const { parse } = await import('parse5');
  const pageDir = dirname(pageFilePath);
  const document = parse(authored, { sourceCodeLocationInfo: true });
  const edits: SourceEdit[] = [];
  const deferred: string[] = [];
  let bodyEnd = authored.length;

  const replaceAttribute = (element: ParsedElement, name: string, value: string) => {
    const location = element.sourceCodeLocation?.attrs?.[name];
    if (!location) return;
    edits.push({
      start: location.startOffset,
      end: location.endOffset,
      text: `${name}="${escapeAttributeValue(value)}"`,
    });
  };

  const inlineMediaAttribute = (element: ParsedElement, name: string) => {
    const value = attribute(element, name);
    if (value === undefined) return;
    const target = classifyReference(value);
    if (target.kind === 'remote') assets.noteRemote(target.url);
    if (target.kind !== 'local') return;
    replaceAttribute(element, name, assets.readDataUri(target.ref, pageDir));
  };

  const inlineSrcset = (element: ParsedElement) => {
    const value = attribute(element, 'srcset');
    // A data: candidate carries commas of its own; such a set is left as written.
    if (value === undefined || /data:/i.test(value)) return;
    const candidates = value.split(',').map((candidate) => {
      const [url = '', ...descriptor] = candidate.trim().split(/\s+/);
      const target = classifyReference(url);
      if (target.kind === 'remote') assets.noteRemote(target.url);
      const inlined = target.kind === 'local' ? assets.readDataUri(target.ref, pageDir) : url;
      return [inlined, ...descriptor].join(' ');
    });
    replaceAttribute(element, 'srcset', candidates.join(', '));
  };

  for (const element of collectElements(document)) {
    const location = element.sourceCodeLocation;
    if (!location) continue;
    const tag = element.tagName;

    if (tag === 'body' && location.endTag) bodyEnd = location.endTag.startOffset;

    if (tag === 'link' && hasToken(attribute(element, 'rel'), 'stylesheet')) {
      const target = classifyReference(attribute(element, 'href') ?? '');
      if (target.kind === 'remote') assets.noteRemote(target.url);
      if (target.kind !== 'local') continue;
      const sheet = assets.readText(target.ref, pageDir);
      const css = assets.inlineCssUrls(sheet.text, dirname(sheet.path));
      const media = attribute(element, 'media');
      const attributes = media ? ` media="${escapeAttributeValue(media)}"` : '';
      edits.push({
        start: location.startOffset,
        end: location.endOffset,
        text: inlineStyleTag(css, attributes),
      });
      continue;
    }

    if (tag === 'script') {
      const src = attribute(element, 'src');
      if (src === undefined) continue;
      const target = classifyReference(src);
      if (target.kind === 'remote') assets.noteRemote(target.url);
      if (target.kind !== 'local') continue;
      const code = assets.readText(target.ref, pageDir).text;
      const isModule = attribute(element, 'type')?.toLowerCase() === 'module';
      const isDeferred = !isModule && attribute(element, 'defer') !== undefined;
      const script = inlineScriptTag(code, keptAttributes(element, ['src', 'defer', 'async']));
      if (isDeferred) deferred.push(script);
      edits.push({
        start: location.startOffset,
        end: location.endOffset,
        text: isDeferred ? '' : script,
      });
      continue;
    }

    if (tag === 'style') {
      const text = element.childNodes[0];
      const textLocation = text?.sourceCodeLocation;
      if (!text || !('value' in text) || !textLocation) continue;
      edits.push({
        start: textLocation.startOffset,
        end: textLocation.endOffset,
        text: assets.inlineCssUrls(text.value, pageDir).replace(/<\/(style)/gi, '<\\/$1'),
      });
    }

    const style = attribute(element, 'style');
    if (style !== undefined && /url\(/i.test(style)) {
      replaceAttribute(element, 'style', assets.inlineCssUrls(style, pageDir));
    }

    if (MEDIA_SRC_TAGS.has(tag)) {
      inlineMediaAttribute(element, 'src');
      inlineSrcset(element);
    }
    if (tag === 'video') inlineMediaAttribute(element, 'poster');
  }

  if (deferred.length > 0) edits.push({ start: bodyEnd, end: bodyEnd, text: deferred.join('') });
  return applyEdits(authored, edits);
}

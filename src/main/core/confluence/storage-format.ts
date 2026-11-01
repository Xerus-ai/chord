import type { DefaultTreeAdapterMap } from 'parse5';

type ParsedNode = DefaultTreeAdapterMap['node'];
type ParsedElement = DefaultTreeAdapterMap['element'];

/**
 * A file the page needs attached before its images resolve: bytes lifted out
 * of a `data:` image, or an MDX component the publisher must render to PNG.
 */
export type PendingAttachment =
  | { kind: 'bytes'; fileName: string; contentType: string; data: Buffer }
  | { kind: 'mdx-snapshot'; fileName: string; filePath: string };

export interface StorageDocument {
  storage: string;
  attachments: PendingAttachment[];
}

/** Elements Confluence storage format takes as they are (after renaming). */
const KEPT_ELEMENTS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  'u',
  's',
  'code',
  'sub',
  'sup',
  'blockquote',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);
const RENAMED_ELEMENTS: Record<string, string> = { b: 'strong', i: 'em', strike: 's', del: 's' };
/** Dropped with everything inside them: code, chrome, and form controls. */
const DROPPED_ELEMENTS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
  'colgroup',
  'input',
  'button',
  'select',
  'textarea',
]);
const ALIGNABLE = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const COLOR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;
const ALIGN_VALUE = /^(left|right|center|justify)$/i;
const NON_VALUES = new Set(['inherit', 'initial', 'unset', 'currentcolor']);
const SAFE_HREF = /^(https?:|mailto:|#)/i;
const DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/=\s]+)$/i;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

/** CDATA cannot contain its own terminator; split it across two sections. */
function cdata(text: string): string {
  return `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

function isElement(node: ParsedNode): node is ParsedElement {
  return 'tagName' in node;
}

function readAttribute(element: ParsedElement, name: string): string | undefined {
  return element.attrs.find((attr) => attr.name === name)?.value;
}

function readText(node: ParsedNode): string {
  if (node.nodeName === '#text') return (node as DefaultTreeAdapterMap['textNode']).value;
  if (!('childNodes' in node)) return '';
  return node.childNodes.map(readText).join('');
}

function readStyle(element: ParsedElement): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of (readAttribute(element, 'style') ?? '').split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (name && value) declarations.set(name, value);
  }
  return declarations;
}

function codeMacro(language: string | null, text: string): string {
  const parameter = language
    ? `<ac:parameter ac:name="language">${escapeText(language)}</ac:parameter>`
    : '';
  return `<ac:structured-macro ac:name="code">${parameter}<ac:plain-text-body>${cdata(text)}</ac:plain-text-body></ac:structured-macro>`;
}

function attachedImage(fileName: string): string {
  return `<ac:image><ri:attachment ri:filename="${escapeAttribute(fileName)}" /></ac:image>`;
}

/**
 * One conversion run: numbering for tasks, lifted images and component
 * snapshots is per document, so the file names attached to a page are stable
 * for the same content.
 */
class StorageConverter {
  readonly attachments: PendingAttachment[] = [];
  private taskCount = 0;
  private imageCount = 0;
  private componentCount = 0;

  convertChildren(node: ParsedNode): string {
    if (!('childNodes' in node)) return '';
    return node.childNodes.map((child) => this.convertNode(child)).join('');
  }

  private convertNode(node: ParsedNode): string {
    if (node.nodeName === '#text') return escapeText(readText(node));
    if (!isElement(node)) return '';
    const tag = node.tagName.toLowerCase();
    if (DROPPED_ELEMENTS.has(tag)) return '';

    switch (tag) {
      case 'br':
        return '<br />';
      case 'hr':
        return '<hr />';
      case 'a':
        return this.convertLink(node);
      case 'img':
        return this.convertImage(node);
      case 'pre':
        return this.convertCodeBlock(node);
      case 'mark':
      case 'span':
        return this.convertStyledSpan(node, tag);
      case 'mermaid-diagram':
        return codeMacro('mermaid', readText(node));
      case 'mdx-component':
        return this.convertMdxComponent(node);
      case 'chord-attachment-image':
        return attachedImage(this.requireAttribute(node, 'data-file-name'));
      case 'ul':
        if (readAttribute(node, 'data-type') === 'taskList') return this.convertTaskList(node);
        break;
    }

    const name = RENAMED_ELEMENTS[tag] ?? tag;
    if (!KEPT_ELEMENTS.has(name)) return this.convertChildren(node);
    return `<${name}${this.keptAttributes(node, name)}>${this.convertChildren(node)}</${name}>`;
  }

  private keptAttributes(element: ParsedElement, name: string): string {
    if (name === 'th' || name === 'td') {
      return ['colspan', 'rowspan']
        .map((attr) => [attr, readAttribute(element, attr)] as const)
        .filter(([, value]) => value && value !== '1')
        .map(([attr, value]) => ` ${attr}="${escapeAttribute(value!)}"`)
        .join('');
    }
    if (ALIGNABLE.has(name)) {
      const align = readStyle(element).get('text-align');
      if (align && ALIGN_VALUE.test(align)) return ` style="text-align: ${align.toLowerCase()}"`;
    }
    return '';
  }

  private convertLink(element: ParsedElement): string {
    const href = readAttribute(element, 'href');
    const children = this.convertChildren(element);
    if (!href || !SAFE_HREF.test(href.trim())) return children;
    return `<a href="${escapeAttribute(href.trim())}">${children}</a>`;
  }

  private convertImage(element: ParsedElement): string {
    const src = (readAttribute(element, 'src') ?? '').trim();
    const alt = readAttribute(element, 'alt');
    const altAttribute = alt ? ` ac:alt="${escapeAttribute(alt)}"` : '';
    if (/^https?:/i.test(src)) {
      return `<ac:image${altAttribute}><ri:url ri:value="${escapeAttribute(src)}" /></ac:image>`;
    }
    const data = DATA_IMAGE.exec(src);
    if (!data) return '';
    const contentType = data[1]!.toLowerCase();
    this.imageCount += 1;
    const fileName = `image-${this.imageCount}.${IMAGE_EXTENSIONS[contentType]}`;
    this.attachments.push({
      kind: 'bytes',
      fileName,
      contentType,
      data: Buffer.from(data[2]!.replace(/\s/g, ''), 'base64'),
    });
    return `<ac:image${altAttribute}><ri:attachment ri:filename="${escapeAttribute(fileName)}" /></ac:image>`;
  }

  private convertCodeBlock(element: ParsedElement): string {
    const code = element.childNodes.find(
      (child): child is ParsedElement => isElement(child) && child.tagName === 'code'
    );
    const language = /(?:^|\s)language-([\w+#.-]+)/.exec(
      (code && readAttribute(code, 'class')) ?? ''
    )?.[1];
    return codeMacro(language ?? null, readText(code ?? element));
  }

  /** Colour and highlight survive as inline styles; any other span is unwrapped. */
  private convertStyledSpan(element: ParsedElement, tag: 'mark' | 'span'): string {
    const style = readStyle(element);
    const background = style.get('background-color') ?? readAttribute(element, 'data-color');
    const kept = [
      ['color', style.get('color')],
      ['background-color', tag === 'mark' ? background : style.get('background-color')],
    ].filter(
      (entry): entry is [string, string] =>
        !!entry[1] && COLOR_VALUE.test(entry[1]) && !NON_VALUES.has(entry[1].toLowerCase())
    );
    const children = this.convertChildren(element);
    if (kept.length === 0) return children;
    const declarations = kept.map(([name, value]) => `${name}: ${value}`).join('; ');
    return `<span style="${escapeAttribute(declarations)}">${children}</span>`;
  }

  private convertTaskList(element: ParsedElement): string {
    const tasks = element.childNodes
      .filter((child): child is ParsedElement => isElement(child) && child.tagName === 'li')
      .map((item) => {
        this.taskCount += 1;
        const status = readAttribute(item, 'data-checked') === 'true' ? 'complete' : 'incomplete';
        const body = item.childNodes.find(
          (child): child is ParsedElement => isElement(child) && child.tagName === 'div'
        );
        return `<ac:task><ac:task-id>${this.taskCount}</ac:task-id><ac:task-status>${status}</ac:task-status><ac:task-body>${body ? this.convertTaskBody(body) : ''}</ac:task-body></ac:task>`;
      });
    return `<ac:task-list>${tasks.join('')}</ac:task-list>`;
  }

  /** A task body is inline content: its paragraphs become line breaks. */
  private convertTaskBody(body: ParsedElement): string {
    return body.childNodes
      .map((child) =>
        isElement(child) && child.tagName === 'p'
          ? this.convertChildren(child)
          : this.convertNode(child)
      )
      .filter((part) => part !== '')
      .join('<br />');
  }

  private convertMdxComponent(element: ParsedElement): string {
    this.componentCount += 1;
    const fileName = `component-${this.componentCount}.png`;
    this.attachments.push({
      kind: 'mdx-snapshot',
      fileName,
      filePath: this.requireAttribute(element, 'data-path'),
    });
    return attachedImage(fileName);
  }

  private requireAttribute(element: ParsedElement, name: string): string {
    const value = readAttribute(element, name);
    if (!value) throw new Error(`<${element.tagName}> has no ${name}`);
    return value;
  }
}

/**
 * Converts the artifact editor's HTML to Confluence storage format. Output is
 * well-formed XHTML: text and attributes escaped, void elements closed, code
 * in CDATA. Elements Confluence has no equivalent for are unwrapped to their
 * content; scripts, styles and form controls are dropped with their content.
 */
export async function convertHtmlToStorage(html: string): Promise<StorageDocument> {
  const { parseFragment } = await import('parse5');
  const converter = new StorageConverter();
  const storage = converter.convertChildren(parseFragment(html));
  return { storage, attachments: converter.attachments };
}

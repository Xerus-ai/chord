import * as Y from 'yjs';

// Document content is editable by ANY participant, so everything user-
// authored — text runs and attribute values — is entity-escaped before it is
// interpolated into markup. Tag and attribute NAMES come from the Yjs schema
// (node/mark names), but are still restricted to a safe character set rather
// than trusted. The renderer parses this through the Tiptap schema (which
// drops unknown nodes) — the escaping here keeps the payload itself clean so
// no other consumer ever receives live markup built from document text.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '');
}

function attributesToHtml(attrs: Record<string, unknown>): string {
  return Object.entries(attrs)
    .map(([k, v]) => {
      const key = sanitizeName(k);
      if (!key) return '';
      return ` ${key}="${escapeHtml(String(v))}"`;
    })
    .join('');
}

/**
 * Serializes a Y.XmlText with its formatting marks. Y.XmlText.toString()
 * emits mark tags AND raw text in one string with no escaping, so it cannot
 * be used here; the delta form separates text runs from their marks, letting
 * the text be escaped while the marks become tags.
 */
function xmlTextToHtml(text: Y.XmlText): string {
  const delta = text.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[];
  return delta
    .map((op) => {
      if (typeof op.insert !== 'string') return '';
      let html = escapeHtml(op.insert);
      for (const [mark, markAttrs] of Object.entries(op.attributes ?? {})) {
        const tag = sanitizeName(mark);
        if (!tag) continue;
        const attrStr =
          markAttrs && typeof markAttrs === 'object'
            ? attributesToHtml(markAttrs as Record<string, unknown>)
            : '';
        html = `<${tag}${attrStr}>${html}</${tag}>`;
      }
      return html;
    })
    .join('');
}

export function xmlFragmentToHtml(fragment: Y.XmlFragment): string {
  const parts: string[] = [];
  for (let i = 0; i < fragment.length; i++) {
    const item = fragment.get(i);
    if (item instanceof Y.XmlElement) {
      parts.push(xmlElementToHtml(item));
    } else if (item instanceof Y.XmlText) {
      parts.push(xmlTextToHtml(item));
    }
  }
  return parts.join('');
}

function xmlElementToHtml(element: Y.XmlElement): string {
  const tag = sanitizeName(element.nodeName) || 'div';
  const attrStr = attributesToHtml(element.getAttributes());

  const children: string[] = [];
  for (let i = 0; i < element.length; i++) {
    const child = element.get(i);
    if (child instanceof Y.XmlElement) {
      children.push(xmlElementToHtml(child));
    } else if (child instanceof Y.XmlText) {
      children.push(xmlTextToHtml(child));
    }
  }

  return `<${tag}${attrStr}>${children.join('')}</${tag}>`;
}

import { describe, expect, it } from 'vitest';
import {
  PageTextEditRejectedError,
  replaceChordElementText,
  stampChordIds,
} from './page-element-ids';
import { loadParse5 } from './page-source-elements';

const parse5 = await loadParse5();

/** Every stamp removed — what the source was before publishing. */
function unstamp(html: string): string {
  return html.replace(/ data-chord-id="[a-z0-9]+"/g, '');
}

function idOf(html: string, openTag: RegExp): string {
  const match = new RegExp(
    `${openTag.source.replace('>', '')}[^>]*data-chord-id="([a-z0-9]+)"`
  ).exec(html);
  if (!match) throw new Error(`No stamp on ${openTag}`);
  return match[1];
}

/** A UTF-8 byte-order mark: parse5 must keep source offsets right past it. */
const BOM = String.fromCharCode(0xfeff);

const PAGE = [
  BOM + '<!doctype html>\r\n',
  '<html lang="en">\r\n',
  '<head><title>Report</title><style>h1 { color: var(--text); }</style></head>\r\n',
  '<body>\r\n',
  '  <h1 class="hero">\r\n    Quarterly &amp; yearly\r\n  </h1>\r\n',
  '  <p>Mixed <b>bold</b> copy</p>\r\n',
  '  <ul><li>One</li><li>Two</li></ul>\r\n',
  '  <button/>Go</button>\r\n',
  '  <div id="empty"></div>\r\n',
  '  <svg><text>chart</text></svg>\r\n',
  '  <script>document.getElementById("empty").textContent = "<p>built</p>";</script>\r\n',
  '  <textarea>draft</textarea>\r\n',
  '</body>\r\n',
  '</html>\r\n',
].join('');

describe('stampChordIds', () => {
  it('stamps every pickable source element and changes no other byte', () => {
    const { html, stamped } = stampChordIds(parse5, PAGE);
    // h1, p, b, ul, li, li, button, div, svg — not html/head/body, not the
    // svg's children, not metadata, code or form internals.
    expect(stamped).toBe(9);
    expect(unstamp(html)).toBe(PAGE);
    for (const tag of [/<h1/, /<p/, /<b/, /<ul/, /<button/, /<div/, /<svg/]) {
      expect(idOf(html, tag)).toMatch(/^[a-z0-9]{8}$/);
    }
    expect(html).not.toMatch(
      /<(html|head|body|text|script|textarea|title|style)[^>]*data-chord-id/
    );
  });

  it('stamps images, inputs and mixed-content paragraphs, but not void metadata or line breaks', () => {
    const { html, stamped } = stampChordIds(
      parse5,
      '<p>Hi <br> <img src="a.png"> <input type="text"> <hr></p><meta name="x"><link rel="a">'
    );
    expect(stamped).toBe(4); // p, img, input, hr
    expect(html).not.toMatch(/<(br|meta|link)[^>]*data-chord-id/);
  });

  it('is idempotent: a second publish of a stamped page is no diff', () => {
    const once = stampChordIds(parse5, PAGE).html;
    expect(stampChordIds(parse5, once)).toEqual({ html: once, stamped: 0 });
  });

  it('keeps existing ids and stamps only what the agent added since', () => {
    const once = stampChordIds(parse5, PAGE).html;
    const headingId = idOf(once, /<h1/);
    const edited = once.replace('</ul>', '<li>Three</li></ul>');
    const { html, stamped } = stampChordIds(parse5, edited);
    expect(stamped).toBe(1);
    expect(idOf(html, /<h1/)).toBe(headingId);
    expect(unstamp(html)).toBe(unstamp(edited));
  });

  it('re-stamps a duplicated id and an invalid one', () => {
    const once = stampChordIds(parse5, '<p>a</p><p>b</p>').html;
    const firstId = idOf(once, /<p/);
    const copied = `${once}<p data-chord-id="${firstId}">c</p><p data-chord-id="Bad Id!">d</p>`;
    const { html, stamped } = stampChordIds(parse5, copied);
    expect(stamped).toBe(2);
    const ids = [...html.matchAll(/data-chord-id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe(firstId);
  });

  it('stamps a bare fragment without inventing markup around it', () => {
    const { html } = stampChordIds(parse5, '<h2>Title</h2>');
    expect(html).toMatch(/^<h2 data-chord-id="[a-z0-9]{8}">Title<\/h2>$/);
  });
});

describe('stampChordIds rebinding from the previous published version', () => {
  const ids = (html: string) => [...html.matchAll(/data-chord-id="([^"]+)"/g)].map((m) => m[1]);
  /** The id on the element whose open tag is followed by exactly `text`. */
  const idBefore = (html: string, text: string): string => {
    const match = new RegExp(`data-chord-id="([a-z0-9]+)"[^>]*>${text}<`).exec(html);
    if (!match) throw new Error(`No stamped element reads ${text}`);
    return match[1];
  };

  it('gives a copy inserted ABOVE the original a fresh id; the original keeps its id', () => {
    const previous = stampChordIds(parse5, '<ul><li>One</li><li>Two</li></ul>').html;
    const oneId = idBefore(previous, 'One');
    const twoId = idBefore(previous, 'Two');
    const copied = previous.replace('<li', `<li data-chord-id="${oneId}">Copy</li><li`);
    const { html, stamped } = stampChordIds(parse5, copied, previous);
    expect(stamped).toBe(1);
    expect(idBefore(html, 'One')).toBe(oneId);
    expect(idBefore(html, 'Two')).toBe(twoId);
    expect(idBefore(html, 'Copy')).not.toBe(oneId);
    expect(new Set(ids(html)).size).toBe(4);
  });

  it('prefers the duplicate with the previous tag and text, wherever it sits', () => {
    const previous = stampChordIds(parse5, '<div><p>Alpha</p><p>Beta</p></div>').html;
    const alphaId = idBefore(previous, 'Alpha');
    const current = `<div><p data-chord-id="${alphaId}">Beta</p><p data-chord-id="${alphaId}">Alpha</p></div>`;
    const { html } = stampChordIds(parse5, current, previous);
    expect(html).toMatch(new RegExp(`<p data-chord-id="${alphaId}">Alpha</p>`));
    expect(html).not.toMatch(new RegExp(`<p data-chord-id="${alphaId}">Beta</p>`));
  });

  it('among verbatim copies, keeps the id on the one whose attributes also match', () => {
    const previous = stampChordIds(parse5, '<p class="lead">Same</p>').html;
    const [id] = ids(previous);
    const copiedAbove = `<p data-chord-id="${id}">Same</p><p data-chord-id="${id}" class="lead">Same</p>`;
    const { html } = stampChordIds(parse5, copiedAbove, previous);
    expect(html).toMatch(new RegExp(`<p data-chord-id="${id}" class="lead">Same</p>$`));
    expect(html).not.toMatch(new RegExp(`^<p data-chord-id="${id}">`));
  });

  it('gives a rewritten element (tag regenerated without the attribute) its old id back', () => {
    const previous = stampChordIds(parse5, '<h1 class="a">Title</h1><p>Body</p>').html;
    const [titleId, bodyId] = ids(previous);
    const rewritten = `<h1 class="b">Title</h1><p data-chord-id="${bodyId}">Body</p>`;
    const { html, stamped } = stampChordIds(parse5, rewritten, previous);
    expect(stamped).toBe(1);
    expect(html).toBe(
      `<h1 data-chord-id="${titleId}" class="b">Title</h1><p data-chord-id="${bodyId}">Body</p>`
    );
  });

  it('does not recover an id that is ambiguous or already in use', () => {
    const previous = stampChordIds(parse5, '<li>Same</li><li>Other</li>').html;
    const [sameId, otherId] = ids(previous);
    // Two unstamped candidates for one previous element: neither may claim it.
    const ambiguous = stampChordIds(parse5, `<li>Same</li><li>Same</li>`, previous).html;
    expect(ids(ambiguous)).not.toContain(sameId);
    expect(new Set(ids(ambiguous)).size).toBe(2);
    // The previous id now sits on another element: the rewritten one gets a fresh id.
    const taken = stampChordIds(
      parse5,
      `<li data-chord-id="${sameId}">Moved</li><li>Same</li>`,
      previous
    ).html;
    const [first, second] = ids(taken);
    expect(first).toBe(sameId);
    expect(second).not.toBe(sameId);
    expect(second).not.toBe(otherId);
  });

  it('falls back to document order for a duplicate the previous version never had', () => {
    const previous = stampChordIds(parse5, '<p>a</p>').html;
    const current = '<p data-chord-id="newid001">x</p><p data-chord-id="newid001">y</p>';
    const { html } = stampChordIds(parse5, current, previous);
    expect(ids(html)[0]).toBe('newid001');
    expect(ids(html)[1]).not.toBe('newid001');
  });
});

describe('replaceChordElementText', () => {
  const stamped = stampChordIds(parse5, PAGE).html;
  const headingId = idOf(stamped, /<h1/);

  it('rewrites that element only, keeping the source whitespace around the text', () => {
    const { html, changed } = replaceChordElementText(parse5, stamped, {
      chordId: headingId,
      originalText: '\n    Quarterly & yearly\n  ',
      text: 'Annual <review> & plan',
    });
    expect(changed).toBe(true);
    expect(html).toBe(
      stamped.replace('Quarterly &amp; yearly', 'Annual &lt;review&gt; &amp; plan')
    );
  });

  it('writes a no-break space as &nbsp;', () => {
    const { html } = replaceChordElementText(parse5, stamped, {
      chordId: headingId,
      originalText: 'Quarterly & yearly',
      text: `Q3${String.fromCharCode(0xa0)}2026`,
    });
    expect(html).toContain('\r\n    Q3&nbsp;2026\r\n');
  });

  it('reports no change when only surrounding whitespace differs', () => {
    const result = replaceChordElementText(parse5, stamped, {
      chordId: headingId,
      originalText: 'Quarterly & yearly',
      text: '  Quarterly & yearly ',
    });
    expect(result).toEqual({ html: stamped, changed: false });
  });

  it('refuses an edit whose starting text is not the source text', () => {
    expect(() =>
      replaceChordElementText(parse5, stamped, {
        chordId: headingId,
        originalText: 'Text the script put there',
        text: 'Anything',
      })
    ).toThrow(PageTextEditRejectedError);
  });

  it('refuses empty text, an unknown id, and an element that is no longer plain text', () => {
    expect(() =>
      replaceChordElementText(parse5, stamped, {
        chordId: headingId,
        originalText: 'Quarterly & yearly',
        text: ' \n ',
      })
    ).toThrow(/cannot be empty/);
    expect(() =>
      replaceChordElementText(parse5, stamped, { chordId: 'zzzzzzzz', originalText: '', text: 'x' })
    ).toThrow(/no longer in the page source/);
    const nested = stamped.replace('Quarterly &amp; yearly', 'Quarterly <em>now</em>');
    expect(() =>
      replaceChordElementText(parse5, nested, {
        chordId: headingId,
        originalText: 'Quarterly now',
        text: 'x',
      })
    ).toThrow(/no longer plain text/);
  });

  it('patches an element whose end tag the source leaves implied', () => {
    const page = stampChordIds(parse5, '<ul><li>One<li>Two</ul>').html;
    const secondId = [...page.matchAll(/data-chord-id="([a-z0-9]+)"/g)][2][1];
    const { html } = replaceChordElementText(parse5, page, {
      chordId: secondId,
      originalText: 'Two',
      text: 'Deux',
    });
    expect(unstamp(html)).toBe('<ul><li>One<li>Deux</ul>');
  });
});

import { describe, expect, it } from 'vitest';
import { convertHtmlToStorage } from './storage-format';

/**
 * The editor's HTML (TipTap `getHTML()`, the live document) to Confluence
 * storage format — XHTML with Confluence's `ac:`/`ri:` elements. Fixtures are
 * the shapes the artifact editor's extensions actually emit.
 */
describe('convertHtmlToStorage', () => {
  it('keeps prose, escapes text and closes void elements', async () => {
    const { storage, attachments } = await convertHtmlToStorage(
      '<h1>Title</h1><p>Hello <strong>bold</strong> &amp; <em>a &lt; b</em> <a href="https://example.com/x?a=1&amp;b=2">link</a><br>next</p><hr>'
    );
    expect(storage).toBe(
      '<h1>Title</h1><p>Hello <strong>bold</strong> &amp; <em>a &lt; b</em> <a href="https://example.com/x?a=1&amp;b=2">link</a><br />next</p><hr />'
    );
    expect(attachments).toEqual([]);
  });

  it('turns a code block into the code macro, with CDATA that survives "]]>"', async () => {
    const { storage } = await convertHtmlToStorage(
      '<pre><code class="language-ts">if (a &lt; b &amp;&amp; x[y[0]]&gt;1) {}</code></pre>'
    );
    expect(storage).toBe(
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">ts</ac:parameter>' +
        '<ac:plain-text-body><![CDATA[if (a < b && x[y[0]]]]><![CDATA[>1) {}]]></ac:plain-text-body></ac:structured-macro>'
    );
  });

  it('turns a task list into Confluence tasks', async () => {
    const { storage } = await convertHtmlToStorage(
      '<ul data-type="taskList">' +
        '<li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Ship <strong>it</strong></p></div></li>' +
        '<li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>Review</p></div></li>' +
        '</ul>'
    );
    expect(storage).toBe(
      '<ac:task-list>' +
        '<ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>Ship <strong>it</strong></ac:task-body></ac:task>' +
        '<ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body>Review</ac:task-body></ac:task>' +
        '</ac:task-list>'
    );
  });

  it('keeps tables, dropping the default spans the editor writes', async () => {
    const { storage } = await convertHtmlToStorage(
      '<table style="min-width: 50px"><colgroup><col></colgroup><tbody>' +
        '<tr><th colspan="1" rowspan="1"><p>A</p></th><th colspan="1" rowspan="1"><p>B</p></th></tr>' +
        '<tr><td colspan="2" rowspan="1"><p>1</p></td></tr>' +
        '</tbody></table>'
    );
    expect(storage).toBe(
      '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td colspan="2"><p>1</p></td></tr></tbody></table>'
    );
  });

  it('keeps colour, highlight and alignment as safe inline styles only', async () => {
    const { storage } = await convertHtmlToStorage(
      '<p style="text-align: center">' +
        '<mark data-color="#fef08a" style="background-color: #fef08a; color: inherit">hi</mark> ' +
        '<span style="color: #dc2626; position: fixed">red</span> ' +
        '<span style="color: url(javascript:alert(1))">bad</span></p>'
    );
    expect(storage).toBe(
      '<p style="text-align: center">' +
        '<span style="background-color: #fef08a">hi</span> ' +
        '<span style="color: #dc2626">red</span> ' +
        'bad</p>'
    );
  });

  it('links remote images and turns data: images into attachments', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { storage, attachments } = await convertHtmlToStorage(
      `<p><img src="https://example.com/a.png" alt="A &quot;chart&quot;"><img src="data:image/png;base64,${png.toString('base64')}"></p>`
    );
    expect(storage).toBe(
      '<p><ac:image ac:alt="A &quot;chart&quot;"><ri:url ri:value="https://example.com/a.png" /></ac:image>' +
        '<ac:image><ri:attachment ri:filename="image-1.png" /></ac:image></p>'
    );
    expect(attachments).toEqual([
      { kind: 'bytes', fileName: 'image-1.png', contentType: 'image/png', data: png },
    ]);
  });

  it('snapshots embedded MDX components and places already-rendered images', async () => {
    const { storage, attachments } = await convertHtmlToStorage(
      '<mdx-component data-path="/repo/chart.mdx" data-work-item-id="w1"></mdx-component>' +
        '<chord-attachment-image data-file-name="component-9.png"></chord-attachment-image>'
    );
    expect(storage).toBe(
      '<ac:image><ri:attachment ri:filename="component-1.png" /></ac:image>' +
        '<ac:image><ri:attachment ri:filename="component-9.png" /></ac:image>'
    );
    expect(attachments).toEqual([
      { kind: 'mdx-snapshot', fileName: 'component-1.png', filePath: '/repo/chart.mdx' },
    ]);
  });

  it('keeps mermaid source as a code macro', async () => {
    const { storage } = await convertHtmlToStorage(
      '<mermaid-diagram>graph TD; A--&gt;B</mermaid-diagram>'
    );
    expect(storage).toBe(
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">mermaid</ac:parameter>' +
        '<ac:plain-text-body><![CDATA[graph TD; A-->B]]></ac:plain-text-body></ac:structured-macro>'
    );
  });

  it('unwraps unknown elements, drops scripts, and drops unsafe links but keeps their text', async () => {
    const { storage } = await convertHtmlToStorage(
      '<div class="x"><section><p>kept</p></section></div><script>alert(1)</script><style>p{}</style>' +
        '<p><a href="javascript:alert(1)">click</a> <a href="#top">top</a></p>'
    );
    expect(storage).toBe('<p>kept</p><p>click <a href="#top">top</a></p>');
  });
});

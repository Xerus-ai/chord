/**
 * Files for the P6 format checks (design 2026-09-24 §9–§10), written into the
 * author's repository: a web page with a sibling stylesheet, a sibling image
 * and one remote reference; an MDX page with a recharts chart and a mermaid
 * diagram; and one real file of each binary kind — pdf, docx, pptx, png. Every
 * file carries the run's marker so a check can find it in what a teammate sees.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import JSZip from 'jszip';

export const REMOTE_SCRIPT = 'https://cdn.example.com/p6-remote.js';

/** A real 64×32 RGB PNG: a gradient, so a screenshot shows it rendered. */
export function encodePng(width = 64, height = 32) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = [0];
    for (let x = 0; x < width; x++) row.push((x * 4) & 255, (y * 8) & 255, 160);
    rows.push(Buffer.from(row));
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A one-page PDF whose only text is `marker`. */
export function encodePdf(marker) {
  const stream = `BT /F1 24 Tf 40 100 Td (${marker}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * A minimal valid Word document with one paragraph: `marker`, on a Letter
 * page with 1" margins — the section properties Word itself always writes.
 */
export async function encodeDocx(marker) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    '_rels/.rels',
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    'word/document.xml',
    `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${marker}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * A pptx package. The app never parses a pptx — it is a card with Open and
 * Save a copy — so only its bytes and MIME type are exercised.
 */
export async function encodePptx(marker) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`
  );
  zip.file('ppt/marker.txt', marker);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function mdxSource(marker) {
  return `import { BarChart, Bar, XAxis, YAxis } from 'recharts';
import { MermaidDiagram } from 'chord-components';

export const data = [
  { name: 'Mon', value: 3 },
  { name: 'Tue', value: 7 },
  { name: 'Wed', value: 5 },
];

# ${marker}

<BarChart width={320} height={160} data={data}>
  <XAxis dataKey="name" />
  <YAxis />
  <Bar dataKey="value" fill="currentColor" />
</BarChart>

<MermaidDiagram chart={\`graph LR
  Draft --> Review --> Shipped\`} />
`;
}

/**
 * Writes every fixture into `dir` and returns their paths and markers. The
 * web page's stylesheet and image are siblings, so they are inlined into its
 * view; the remote script is left alone and reported as a warning.
 */
export async function writeFormatFixtures(dir, stamp) {
  mkdirSync(join(dir, 'site'), { recursive: true });
  const marker = (kind) => `P6 ${kind} ${stamp}`;
  const cssRule = `.p6-${stamp} { color: rebeccapurple; }`;
  writeFileSync(join(dir, 'site', 'page.css'), cssRule);
  writeFileSync(join(dir, 'site', 'dot.png'), encodePng(8, 8));
  writeFileSync(
    join(dir, 'site', `${stamp}-page.html`),
    `<!doctype html><html><head><link rel="stylesheet" href="page.css"><script src="${REMOTE_SCRIPT}"></script></head><body><h1 class="p6-${stamp}">${marker('web page')}</h1><img src="dot.png" alt="dot"></body></html>`
  );
  writeFileSync(join(dir, `${stamp}-report.mdx`), mdxSource(marker('mdx')));
  writeFileSync(join(dir, `${stamp}-brief.pdf`), encodePdf(marker('pdf')));
  writeFileSync(join(dir, `${stamp}-memo.docx`), await encodeDocx(marker('docx')));
  writeFileSync(join(dir, `${stamp}-deck.pptx`), await encodePptx(marker('pptx')));
  writeFileSync(join(dir, `${stamp}-chart.png`), encodePng());

  return {
    cssRule,
    formats: [
      { kind: 'web', path: join(dir, 'site', `${stamp}-page.html`), marker: marker('web page') },
      { kind: 'mdx', path: join(dir, `${stamp}-report.mdx`), marker: marker('mdx') },
      { kind: 'pdf', path: join(dir, `${stamp}-brief.pdf`), marker: marker('pdf') },
      { kind: 'docx', path: join(dir, `${stamp}-memo.docx`), marker: marker('docx') },
      { kind: 'pptx', path: join(dir, `${stamp}-deck.pptx`), marker: marker('pptx') },
      { kind: 'png', path: join(dir, `${stamp}-chart.png`), marker: marker('png') },
    ],
  };
}

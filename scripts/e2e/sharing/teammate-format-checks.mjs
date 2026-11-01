/* global document, getComputedStyle -- frame.evaluate callbacks run inside the artifact frame */
/**
 * Check 14 (design 2026-09-24 §9–§10): every format opened from a chord://
 * link in the teammate's own app, with the author's app CLOSED, renders from
 * what the author uploaded. Each format leaves a screenshot in
 * screenshots/e2e.
 */
import { waitFor } from './sharing-accounts.mjs';
import {
  describePdfLoad,
  findFrameWith,
  followLink,
  pdfFrameIsUnsandboxed,
  screenshot,
  screenshotComposited,
  waitForPdfDocument,
} from './teammate-ui-helpers.mjs';

/**
 * A window this narrow (CSS px) leaves the file view narrower than a Letter
 * page. The artifact's comments/versions panel no longer opens by itself
 * (design 2026-09-26 §3), so the view is 320px wider than it was at 1100.
 */
const NARROW_WINDOW = { width: 1000, height: 800 };

/**
 * How the rendered docx sits in its frame: the frame's own width against
 * what it scrolls, and where the first page's box ends. `pagePaperWidth` is
 * the width docx-preview gave the page before any scaling.
 */
function measureDocxFit(frame) {
  return frame.evaluate(() => {
    const page = document.querySelector('section.docx');
    const wrapper = document.querySelector('.docx-wrapper');
    if (!page || !wrapper) throw new Error('docx-preview rendered no page');
    const box = page.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      pageLeft: Math.round(box.left),
      pageRight: Math.round(box.right),
      pagePaperWidth: Math.round((parseFloat(page.style.width) * 96) / 72),
      zoom: wrapper.style.zoom || '1',
    };
  });
}

function pageFits(fit) {
  return (
    fit.scrollWidth <= fit.clientWidth && fit.pageLeft >= 0 && fit.pageRight <= fit.clientWidth
  );
}

async function withWindowSize(account, size, run) {
  const [width, height] = await account.instance.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getSize()
  );
  const setSize = (w, h) =>
    account.instance.app.evaluate(
      ({ BrowserWindow }, [a, b]) => BrowserWindow.getAllWindows()[0].setSize(a, b),
      [w, h]
    );
  await setSize(size.width, size.height);
  try {
    return await run();
  } finally {
    await setSize(width, height);
  }
}

/** Check 14: each format opened from a link in the teammate's app. */
export async function runTeammateFormatViewChecks({ mate, formats, results }) {
  const { check } = results;
  const { page } = mate.instance;
  const byKind = Object.fromEntries(formats.entries.map((entry) => [entry.kind, entry]));
  const open = (entry) => followLink(mate, `chord://open/artifact/${entry.artifactId}`);

  await open(byKind.web);
  const web = await findFrameWith(page, byKind.web.marker);
  await screenshot(mate, 'format-web');
  check('14a  the web page renders in the teammate app', web !== null);
  if (web) {
    const styled = await web.evaluate(() => getComputedStyle(document.querySelector('h1')).color);
    const image = await web.evaluate(() => document.querySelector('img')?.naturalWidth ?? 0);
    check('14b  …styled by its inlined stylesheet', styled === 'rgb(102, 51, 153)', styled);
    check('14c  …with its inlined image loaded', image > 0, `naturalWidth ${image}`);
  }

  await open(byKind.mdx);
  const mdx = await findFrameWith(page, byKind.mdx.marker);
  let drawn = { chart: 0, diagram: false };
  if (mdx) {
    await waitFor(
      async () => {
        // The diagram is an SVG mermaid drew with the node labels in it — the
        // chart's source text would also say "Review" if mermaid had failed.
        drawn = await mdx.evaluate(() => ({
          chart: document.querySelectorAll('svg.recharts-surface').length,
          diagram: [...document.querySelectorAll('svg:not(.recharts-surface)')].some((svg) =>
            svg.textContent.includes('Review')
          ),
        }));
        return drawn.chart > 0 && drawn.diagram;
      },
      45_000,
      'the MDX chart and diagram'
    ).catch(() => {});
  }
  await screenshot(mate, 'format-mdx');
  check('14d  the MDX page renders in the teammate app', mdx !== null);
  check(
    '14e  …with its recharts chart and mermaid-drawn diagram',
    drawn.chart > 0 && drawn.diagram,
    JSON.stringify(drawn)
  );

  await open(byKind.docx);
  const docx = await findFrameWith(page, byKind.docx.marker);
  await screenshot(mate, 'format-docx');
  const docxPage = docx
    ? await docx.evaluate(() => document.querySelector('.docx-wrapper section.docx') !== null)
    : false;
  check('14f  the docx renders through docx-preview as a page', docxPage);
  if (docxPage) {
    const fit = await measureDocxFit(docx);
    check(
      '14l  …fitting the file view with no sideways scroll',
      pageFits(fit),
      JSON.stringify(fit)
    );
    const narrow = await withWindowSize(mate, NARROW_WINDOW, async () => {
      let measured = fit;
      await waitFor(
        async () => {
          measured = await measureDocxFit(docx);
          return measured.clientWidth < fit.clientWidth;
        },
        10_000,
        'the file view to narrow with the window'
      );
      await screenshot(mate, 'format-docx-narrow');
      return measured;
    });
    check(
      '14m  …and in a window narrower than the page it is scaled down, still whole',
      narrow.clientWidth < narrow.pagePaperWidth && Number(narrow.zoom) < 1 && pageFits(narrow),
      JSON.stringify(narrow)
    );
  }

  await open(byKind.png);
  let width = 0;
  await waitFor(
    async () => {
      for (const frame of page.frames().filter((f) => f.url().startsWith('chord-artifact://'))) {
        width = await frame
          .evaluate(() => document.querySelector('img[src^="data:image/png"]')?.naturalWidth ?? 0)
          .catch(() => 0);
        if (width > 0) return true;
      }
      return false;
    },
    45_000,
    'the image'
  ).catch(() => {});
  await screenshot(mate, 'format-png');
  check('14g  the image renders at its size', width === 64, `naturalWidth ${width}`);

  await open(byKind.pdf);
  const pdfLoad = await waitForPdfDocument(mate);
  await screenshotComposited(mate, 'format-pdf');
  check(
    '14h  the pdf loads in Chromium’s PDF viewer',
    pdfLoad.pages === 1,
    describePdfLoad(pdfLoad)
  );
  check('14i  …in a frame without the sandbox attribute', await pdfFrameIsUnsandboxed(page));

  await open(byKind.pptx);
  const card = page.locator('[data-file-viewer="card"]');
  const cardText = await card
    .waitFor({ timeout: 45_000 })
    .then(() => card.innerText())
    .catch(() => '');
  await screenshot(mate, 'format-pptx');
  // A cloud copy is named after the artifact (prepare-cloud-artifact-file.ts).
  check(
    '14j  the pptx shows its card, named after the artifact',
    cardText.includes(`${byKind.pptx.name}.pptx`),
    cardText.slice(0, 80)
  );
  check('14k  …with Open and Save a copy', /Open/.test(cardText) && /Save a copy/.test(cardText));
}

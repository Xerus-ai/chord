import { readFileSync, writeFileSync } from 'node:fs';
import type { ArtifactType } from '@shared/stream-items';
import { stampChordIds } from './page-element-ids';
import { loadParse5 } from './page-source-elements';

/**
 * Publishing a web page stamps its pickable elements with `data-chord-id` in
 * the source file (plan 2026-09-23 P1b step 1), so the page can be edited in
 * place and commented on per element. Republishing re-stamps whatever the
 * agent added or dropped since; ids already present are kept, so after the
 * first publish the stamps are no diff at all. `previousSource` is the page as
 * last published (its latest version), which decides who keeps a duplicated
 * id and gives a rewritten element its id back (design 2026-09-24 §9
 * "Element identity"); null for a first publish. Other formats are left
 * untouched.
 *
 * The parser loads first; the read, stamp and write then run in one tick, so
 * two publishes of one page cannot interleave between reading and writing it.
 */
export async function stampPublishedPage(
  filePath: string,
  type: ArtifactType,
  previousSource: string | null
): Promise<void> {
  if (type !== 'web') return;
  const parse5 = await loadParse5();
  const source = readFileSync(filePath, 'utf-8');
  const { html, stamped } = stampChordIds(parse5, source, previousSource ?? undefined);
  if (stamped > 0) writeFileSync(filePath, html, 'utf-8');
}

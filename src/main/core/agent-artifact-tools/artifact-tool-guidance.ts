import {
  AUTHORED_ARTIFACT_FORMAT_META,
  AUTHORED_ARTIFACT_FORMATS,
  type PreferredArtifactFormat,
} from '@shared/artifact-formats';

/**
 * What the agent is told about artifacts. It rides on the tool description
 * rather than the prompt, so it reaches the agent exactly when the tool does —
 * a session with artifacts turned off is told nothing about them.
 *
 * The token names below are read by `scripts/token-audit.mjs` (check 6): a
 * token this guidance points agents at must exist in the generated page token
 * sheet, which is all a sandboxed page can see.
 */

const WHEN_TO_PUBLISH =
  'Publish a file you wrote in this workspace as an artifact of the current Chord work item, so the team can read, comment on and edit it. Publish deliverables someone will come back to: plans, specs, reports, briefs, dashboards, prototypes, and anything the user asks to share. Do not publish code, scratch notes, test files, or anything read once in chat, and do not mention that you did not publish them: a file nobody asked to share needs no comment. Publishing a path that is already an artifact updates it (created: false), so publish again after you change the file. Only files inside the session workspace can be published.';

const FORMAT_RULE =
  'format is optional and is derived from the file extension; a format that contradicts the extension is an error, not a conversion. Other files (.pdf, .docx, .pptx, .txt, images) publish with format omitted.';

const SOURCES_RULE =
  'When the artifact describes files in this workspace (the code a design documents, the data a report summarises), list them in sources. Chord marks the artifact out of date when one of them changes, and the user can ask you to update it. Publishing again records the sources as they are now; pass sources again to replace the list.';

const PAGE_RULES =
  'Web pages and prototypes run in a sandbox with no network: inline all CSS and JS, embed images and fonts as data: URIs, keep state in memory (no localStorage), no external scripts, stylesheets or fetch. The page receives Chord theme tokens as CSS variables: use var(--surface), var(--surface-raised), var(--text), var(--text-muted), var(--border), var(--action-bg), var(--action-fg) for neutral structure, and var(--status-ok), var(--status-warn), var(--status-err) only where colour carries meaning. Never hardcode hex colours.';

// Worded without an import statement's shape (the keyword, then `from` and a
// quoted module): electron-vite's esm-shim finds the main chunk's last static
// import by regex and inserts its CommonJS shim after it — inside this string.
const MDX_RULES =
  'Rich documents can use the recharts package for charts, and the chord-components package for InteractiveTable, MermaidDiagram, CodeBlock and Callout; React is global. Export every custom component and keep its logic inside the component function.';

function describeFormats(): string {
  return AUTHORED_ARTIFACT_FORMATS.map((format) => {
    const meta = AUTHORED_ARTIFACT_FORMAT_META[format];
    return `- ${format}: ${meta.label} (${meta.extension}). ${meta.description}`;
  }).join('\n');
}

function describePreference(preferred: PreferredArtifactFormat): string | null {
  if (preferred === 'best-fit') return null;
  const meta = AUTHORED_ARTIFACT_FORMAT_META[preferred];
  return `The user prefers ${meta.label} (${meta.extension}) unless they ask for something else.`;
}

export function buildPublishArtifactDescription(preferred: PreferredArtifactFormat): string {
  return [
    WHEN_TO_PUBLISH,
    `Formats:\n${describeFormats()}`,
    describePreference(preferred),
    FORMAT_RULE,
    SOURCES_RULE,
    PAGE_RULES,
    MDX_RULES,
  ]
    .filter((part): part is string => part !== null)
    .join('\n\n');
}

export const LIST_ARTIFACTS_DESCRIPTION =
  "List the current work item's artifacts: id, path, title, format and review status. Use it before publishing to see whether a document already exists.";

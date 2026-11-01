import { ARTIFACT_FILE_MIME_TYPES, fileTypeRule, MAX_FILE_BYTES } from '../artifact-file-types.js';

/**
 * The file half of a `POST …/versions` body for a render_class 'file'
 * artifact (P6 §10): the file's bytes as base64 and its MIME type, which must
 * belong to the artifact's content type; a view for an image or docx and none
 * for a pdf or pptx; never page source. Decoded bytes are capped at 8 MiB.
 */
export type FileVersionBody =
  | {
      ok: true;
      mimeType: string;
      contentBase64: string;
      byteSize: number;
      viewHtml: string | null;
    }
  | { ok: false; status: 400 | 413; body: Record<string, unknown> };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function refuse(error: string): FileVersionBody {
  return { ok: false, status: 400, body: { error } };
}

export function parseFileVersionBody(
  contentType: string,
  body: { content?: string; view_html?: string; file_base64?: string; mime_type?: string }
): FileVersionBody {
  if (body.content !== undefined) {
    return refuse('A file artifact version carries `file_base64`, never page `content`');
  }
  if (body.file_base64 === undefined || body.mime_type === undefined) {
    return refuse('A file artifact version requires `file_base64` and `mime_type`');
  }
  if (!ARTIFACT_FILE_MIME_TYPES.includes(body.mime_type)) {
    return refuse(`\`mime_type\` must be one of ${ARTIFACT_FILE_MIME_TYPES.join(', ')}`);
  }
  const rule = fileTypeRule(body.mime_type);
  if (rule.contentType !== contentType) {
    return refuse(`\`mime_type\` ${body.mime_type} is not a ${contentType} artifact file`);
  }
  if (rule.hasView && body.view_html === undefined) {
    return refuse(`A ${body.mime_type} version requires \`view_html\`: the view built from it`);
  }
  if (!rule.hasView && body.view_html !== undefined) {
    return refuse(`A ${body.mime_type} version is shown from its bytes and takes no \`view_html\``);
  }
  if (body.file_base64.length % 4 !== 0 || !BASE64.test(body.file_base64)) {
    return refuse('`file_base64` is not base64');
  }
  const byteSize = Buffer.byteLength(body.file_base64, 'base64');
  if (byteSize > MAX_FILE_BYTES) {
    return {
      ok: false,
      status: 413,
      body: { error: 'file_too_large', max_bytes: MAX_FILE_BYTES },
    };
  }
  return {
    ok: true,
    mimeType: body.mime_type,
    contentBase64: body.file_base64,
    byteSize,
    viewHtml: body.view_html ?? null,
  };
}

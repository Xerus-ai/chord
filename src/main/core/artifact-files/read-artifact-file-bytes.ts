import { readFileSync } from 'node:fs';
import {
  MAX_ARTIFACT_FILE_BYTES,
  mimeTypeForArtifactFile,
  type ArtifactFileMimeType,
} from '@shared/artifact-file-types';

/** The file is over the 8 MiB cap (design 2026-09-24 §10 decision 3). */
export class ArtifactFileTooLargeError extends Error {
  constructor(filePath: string, bytes: number) {
    super(
      `${filePath} is ${(bytes / (1024 * 1024)).toFixed(1)} MiB, over the 8 MiB limit for a shared file. Make it smaller, then publish again.`
    );
    this.name = 'ArtifactFileTooLargeError';
  }
}

/** A binary artifact's bytes and MIME type, refused above the 8 MiB cap. */
export function readArtifactFileBytes(filePath: string): {
  bytes: Buffer;
  mimeType: ArtifactFileMimeType;
} {
  const mimeType = mimeTypeForArtifactFile(filePath);
  const bytes = readFileSync(filePath);
  if (bytes.byteLength > MAX_ARTIFACT_FILE_BYTES) {
    throw new ArtifactFileTooLargeError(filePath, bytes.byteLength);
  }
  return { bytes, mimeType };
}

import { resolveArtifactRuntimeDir } from '@main/core/artifact-pages/artifact-runtime-dir';
import { buildFileView } from './build-file-view';
import { loadRepoFileAt } from './prepare-repo-file';
import { registerPreparedFile, type PreparedArtifactFile } from './prepared-artifact-file';

/** The viewer for a repo binary, built from its bytes as a binary artifact's is. */
export async function prepareRepoFileAt(args: {
  workItemId: string;
  checkoutPath: string;
  filePath: string;
}): Promise<PreparedArtifactFile> {
  const file = loadRepoFileAt(args.checkoutPath, args.filePath);
  const view = await buildFileView({
    fileName: file.fileName,
    mimeType: file.mimeType,
    bytes: file.bytes,
    runtimeDir: resolveArtifactRuntimeDir(),
  });
  return registerPreparedFile({
    artifactId: `repo:${args.workItemId}:${file.diskPath}`,
    versionKey: null,
    fileName: file.fileName,
    mimeType: file.mimeType,
    bytes: file.bytes,
    versionId: null,
    versionNumber: null,
    view,
  });
}

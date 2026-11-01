import { type PageTheme } from '@shared/artifact-frame-constants';
import { pageTextEditSchema, pageThemeSchema } from '@shared/artifact-frame-messages';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { resolveWorkItemCheckout } from '@main/core/work-items/work-item-checkout';
import { ArtifactViewMissingError, fetchCloudArtifactView } from './cloud-page-view';
import { commitPageTextEdit, type PageTextEdit } from './commit-page-text-edit';
import { PageTextEditRejectedError } from './page-element-ids';
import {
  ArtifactPageNotFoundError,
  registerArtifactPageSource,
  registerArtifactVersionSource,
  registerEmbeddedMdxSource,
  registerRepoFilePageSource,
  registerSnapshotPageSource,
  type PageSource,
} from './page-source-registry';
import { preparePage } from './prepare-page';

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A view fetched from the cloud, served verbatim at an origin of its own —
 * the one path both a teammate's view and a public link's view take.
 */
function prepareSnapshotPage(
  view: { artifactId: string; versionId: string; html: string },
  theme: PageTheme
): Promise<string> {
  return preparePage(registerSnapshotPageSource(view), theme);
}

/**
 * Registers, compiles what needs compiling, and hands back the frame URL.
 * Only two outcomes are typed errors the host renders: the artifact row is
 * missing (`not_found`) and the page does not compile (`build_error`). A
 * database or disk failure in registration is neither; it propagates as an
 * RPC failure instead of being reported as a missing artifact.
 */
async function prepareFromRegistration(
  registerSource: () => Promise<PageSource>,
  theme: PageTheme
) {
  let source: PageSource;
  try {
    source = await registerSource();
  } catch (error) {
    if (error instanceof ArtifactPageNotFoundError) {
      return err({ type: 'not_found' as const, message: error.message });
    }
    throw error;
  }
  try {
    return ok({ url: await preparePage(source, theme), kind: source.kind });
  } catch (error) {
    return err({ type: 'build_error' as const, message: describe(error) });
  }
}

/**
 * The renderer asks main to prepare a page before mounting its frame. A
 * compile failure is a typed error here — the frame is never mounted, so a
 * broken prototype shows as an error state rather than a blank page.
 */
export const artifactPagesController = createRPCController({
  prepare: async (args: { artifactId: string; theme: PageTheme }) =>
    prepareFromRegistration(
      () => registerArtifactPageSource(args.artifactId),
      pageThemeSchema.parse(args.theme)
    ),

  /**
   * A repo file that is no artifact, previewed as the page it is (design
   * 2026-09-26 §3). An unknown work item or worktree is `not_found`.
   */
  prepareRepoFile: async (args: {
    workItemId: string;
    filePath: string;
    worktreeId?: string;
    theme: PageTheme;
  }) => {
    const checkout = await resolveWorkItemCheckout(args.workItemId, args.worktreeId);
    if (!checkout.success) {
      return err({ type: 'not_found' as const, message: checkout.error.type });
    }
    return prepareFromRegistration(
      async () =>
        registerRepoFilePageSource({
          workItemId: args.workItemId,
          checkoutPath: checkout.data,
          filePath: args.filePath,
        }),
      pageThemeSchema.parse(args.theme)
    );
  },

  /** A stored version of a page, previewed at its own content-addressed origin. */
  prepareVersion: async (args: {
    artifactId: string;
    versionId: string;
    content: string;
    theme: PageTheme;
  }) =>
    prepareFromRegistration(
      () =>
        registerArtifactVersionSource({
          artifactId: args.artifactId,
          versionId: args.versionId,
          content: args.content,
        }),
      pageThemeSchema.parse(args.theme)
    ),

  /**
   * A page viewed off its author's device (design 2026-09-24 §9 "Desktop
   * contract"): the view the author uploaded, fetched from the cloud and
   * served verbatim at its own origin. No view yet is the typed `no_view`;
   * a network or server failure propagates as an RPC failure.
   */
  prepareCloud: async (args: {
    workItemId: string;
    artifactId: string;
    versionId?: string;
    theme: PageTheme;
  }) => {
    const theme = pageThemeSchema.parse(args.theme);
    let view;
    try {
      view = await fetchCloudArtifactView(args);
    } catch (error) {
      if (error instanceof ArtifactViewMissingError) {
        return err({ type: 'no_view' as const, message: error.message });
      }
      throw error;
    }
    const url = await prepareSnapshotPage(
      { artifactId: args.artifactId, versionId: view.versionId, html: view.html },
      theme
    );
    return ok({
      url,
      versionId: view.versionId,
      versionNumber: view.versionNumber,
      trigger: view.trigger,
      authorName: view.authorName,
      createdAt: view.createdAt,
    });
  },

  prepareEmbeddedMdx: async (args: { filePath: string; workItemId: string; theme: PageTheme }) => {
    const theme = pageThemeSchema.parse(args.theme);
    let source: PageSource;
    try {
      source = registerEmbeddedMdxSource({ filePath: args.filePath, workItemId: args.workItemId });
    } catch (error) {
      return err({ type: 'rejected' as const, message: describe(error) });
    }
    try {
      return ok({ url: await preparePage(source, theme), kind: source.kind });
    } catch (error) {
      return err({ type: 'build_error' as const, message: describe(error) });
    }
  },

  /**
   * Edit in place (plan P1b step 2): the frame reported new text for one
   * stamped element. The arguments come from an untrusted page, so they are
   * re-validated here against the shared schema's limits and against the
   * source file itself. A refusal the user can act on is a typed error; a disk
   * or database failure propagates.
   */
  commitTextEdit: async (args: PageTextEdit) => {
    const edit = pageTextEditSchema.parse(args);
    try {
      return ok(await commitPageTextEdit(edit));
    } catch (error) {
      if (error instanceof PageTextEditRejectedError) {
        return err({ type: 'rejected' as const, message: error.message });
      }
      throw error;
    }
  },
});

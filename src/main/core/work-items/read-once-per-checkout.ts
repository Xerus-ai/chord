/** What a checkout's change read depends on. */
export interface CheckoutReadInput {
  id: string;
  path: string;
  branchName: string | null;
  targetRef: string | null;
}

/**
 * Runs `read` once per distinct checkout — path, branch and target — and maps
 * the result to every row that shares it, by row id. Work items without a
 * worktree of their own share one checkout, and each read spawns git, which
 * holds main's thread; reading the same checkout once per row multiplied that
 * by the number of items on it. A failed read fails the call, as one read per
 * row did.
 */
export async function readOncePerCheckout<TRow extends CheckoutReadInput, TResult>(
  rows: readonly TRow[],
  read: (row: TRow) => Promise<TResult>
): Promise<Map<string, TResult>> {
  const reads = new Map<string, Promise<TResult>>();
  const entries = await Promise.all(
    rows.map(async (row) => {
      const key = JSON.stringify([row.path, row.branchName, row.targetRef]);
      let pending = reads.get(key);
      if (!pending) {
        pending = read(row);
        reads.set(key, pending);
      }
      return [row.id, await pending] as const;
    })
  );
  return new Map(entries);
}

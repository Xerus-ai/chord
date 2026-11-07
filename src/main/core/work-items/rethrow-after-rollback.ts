/**
 * For a step that throws after an earlier one already changed something:
 * undoes that change, then throws the step's own error. A rollback that fails
 * as well is named beside it, with the original kept as the cause.
 */
export async function rethrowAfterRollback(
  error: unknown,
  rollback: () => Promise<void>
): Promise<never> {
  try {
    await rollback();
  } catch (rollbackError) {
    throw new Error(
      `${String(error)} (and undoing what it had made failed: ${String(rollbackError)})`,
      {
        cause: error,
      }
    );
  }
  throw error;
}

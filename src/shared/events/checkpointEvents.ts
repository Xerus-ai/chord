import { defineEvent } from '@shared/ipc/events';

/** A checkpoint of the work item was saved (main/core/checkpoints): its chat's Reset and Fork read it. */
export const checkpointSavedChannel = defineEvent<{ workItemId: string }>('checkpoint:saved');

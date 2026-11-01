import { defineEvent } from '@shared/ipc/events';
import type { SoloView } from '@shared/solo';

/** A repository's Solo slot changed: holder, queue or interrupted hold (main/core/solo). */
export const soloChangedChannel = defineEvent<SoloView>('solo:changed');

import { defineEvent } from '@shared/ipc/events';
import type { LaneRunState } from '@shared/lane-runs';

/** A lane's run scripts or test changed state (main/core/lane-runs). */
export const laneRunChangedChannel = defineEvent<LaneRunState>('lane:run-changed');

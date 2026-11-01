/** A file an artifact was written from, changed since the artifact was published or reviewed. */
export interface ChangedSource {
  path: string;
  change: 'modified' | 'deleted';
}

/** An out-of-date artifact (plan 2026-09-23 §4 P4 step 2). */
export interface ArtifactSourceDrift {
  artifactId: string;
  filePath: string;
  changed: ChangedSource[];
}

/** The work item's complete drift list, re-sent whole whenever it may have changed. */
export interface WorkItemSourceDrift {
  workItemId: string;
  drift: ArtifactSourceDrift[];
}

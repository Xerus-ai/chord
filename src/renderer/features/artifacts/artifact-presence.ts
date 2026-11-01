/**
 * The presence `file` of an open artifact. Presence is kept per work item, so
 * every surface names itself through `file`; an artifact tab is this key.
 */
export function artifactPresenceFile(artifactId: string): string {
  return `artifact:${artifactId}`;
}

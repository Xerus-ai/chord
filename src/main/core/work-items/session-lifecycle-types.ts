export interface SessionLifecycleCallbacks {
  onExit: (exitCode: number | undefined) => void;
}

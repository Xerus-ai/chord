import type { Plugin } from 'vite';

export declare const ARTIFACT_RUNTIME_OUT_DIR: string;
export declare function buildArtifactRuntime(outDir?: string): Promise<{
  runtimeBytes: number;
  standaloneRuntimeBytes: number;
  mermaidBytes: number;
}>;
export declare function artifactRuntimePlugin(): Plugin;

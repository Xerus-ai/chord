import type { Plugin } from 'vite';

export declare const CHORD_MCP_OUT_DIR: string;
export declare function buildChordMcpShim(outDir?: string): Promise<void>;
export declare function chordMcpShimPlugin(): Plugin;

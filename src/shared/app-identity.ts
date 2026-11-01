type ImportMetaWithEnv = ImportMeta & { env?: { VITE_BUILD?: string } };

const isCanary = (import.meta as ImportMetaWithEnv).env?.VITE_BUILD === 'canary';

export const APP_ID = isCanary ? 'com.chord.canary' : 'com.chord.stable';
export const PRODUCT_NAME = isCanary ? 'Chord Canary' : 'Chord';
export const APP_NAME_LOWER = isCanary ? 'chord-canary' : 'chord';
export const UPDATE_CHANNEL = isCanary ? 'v1-canary' : 'v1-stable';
export const ARTIFACT_PREFIX = isCanary ? 'chord-canary' : 'chord';
/** The project's home page: who Chord is, to services that ask (OpenRouter's HTTP-Referer). */
export const PRODUCT_URL = 'https://xerus.ai';

const _R2_DEFAULT = 'https://releases.xerus.ai';
export const R2_BASE_URL: string =
  typeof process !== 'undefined' && process.env?.R2_BASE_URL
    ? process.env.R2_BASE_URL
    : _R2_DEFAULT;

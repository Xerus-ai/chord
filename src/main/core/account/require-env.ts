import { app } from 'electron';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value) return value;

  if (app.isPackaged) {
    throw new Error(
      `Missing required environment variable: ${name}. Set it before launching Chord.`
    );
  }

  return '';
}

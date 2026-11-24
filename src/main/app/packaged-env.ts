/**
 * The sign-in and cloud addresses a release build bakes in (devstation-pqub;
 * scripts/release/lib/build-env.ts): a packaged app has no .env, so without them its main
 * process refuses to start. Imported before dotenv, so a stray .env in the launch folder cannot
 * repoint a release; a variable already in the environment still wins. A development build
 * bakes nothing and reads .env as before.
 */
declare const __CHORD_PACKAGED_ENV__: Record<string, string>;

for (const [name, value] of Object.entries(__CHORD_PACKAGED_ENV__)) {
  if (process.env[name] === undefined) process.env[name] = value;
}

// A module, so it can be imported for its effect (src/main/index.ts and its test).
export {};

import type { Configuration } from 'electron-builder';
import {
  APP_ID,
  ARTIFACT_PREFIX,
  PRODUCT_NAME,
  R2_BASE_URL,
  UPDATE_CHANNEL,
} from './src/shared/app-identity';

const config: Configuration = {
  appId: APP_ID,
  productName: PRODUCT_NAME,
  directories: { output: 'release' },
  artifactName: `${ARTIFACT_PREFIX}-\${arch}.\${ext}`,
  publish: [
    {
      provider: 'generic',
      url: R2_BASE_URL,
      channel: UPDATE_CHANNEL,
    },
  ],
  generateUpdatesFilesForAllChannels: false,
  files: ['out/**/*', 'node_modules/**/*', 'drizzle/**/*'],
  // Chord's license, the upstream attribution (Apache-2.0 §4) and the font
  // licenses ship next to the app, in resources/.
  extraResources: [
    { from: 'LICENSE', to: 'LICENSE' },
    { from: 'NOTICE', to: 'NOTICE' },
    { from: 'LICENSES', to: 'LICENSES' },
  ],
  asarUnpack: [
    // esbuild spawns its platform binary; a binary inside the asar cannot
    // be executed. It compiles MDX components and .tsx prototypes at runtime.
    'node_modules/esbuild/**',
    'node_modules/@esbuild/**',
    // The Claude Agent SDK spawns its platform's Claude Code binary for every
    // chat session (claude-sdk/claude-executable-path.ts).
    'node_modules/@anthropic-ai/claude-agent-sdk-*/**',
    // Agents spawn the chord MCP stdio shim with Chord's executable in Node
    // mode (agent-artifact-tools/chord-mcp-access.ts).
    'out/chord-mcp/**',
    'node_modules/better-sqlite3/**',
    'node_modules/node-pty/**',
    'node_modules/@parcel/watcher/**',
    '**/*.node',
  ],
  mac: {
    category: 'public.app-category.developer-tools',
    hardenedRuntime: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    icon: 'src/assets/images/chord/app-icon.icns',
    notarize: false,
  },
  dmg: {
    icon: 'src/assets/images/chord/app-icon.icns',
  },
  linux: {
    icon: 'src/assets/images/chord/app-icon.png',
    category: 'Development',
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
  },
  win: {
    icon: 'src/assets/images/chord/app-icon.png',
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'msi', arch: ['x64'] },
    ],
  },
  msi: {
    oneClick: false,
    perMachine: false,
  },
  nsis: {
    differentialPackage: true,
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
  },
  npmRebuild: false,
};

export default config;

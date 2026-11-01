import 'dotenv/config';
import { assertShareLinksConfigured } from './access/share-link-tokens.js';
import { startHocuspocusServer } from './hocuspocus.js';
import { startServer } from './server.js';

// Public artifact links (P6) are issued and verified with these; refuse to
// start without them rather than fail on the first share.
assertShareLinksConfigured();

const port = parseInt(process.env.PORT || '1234', 10);
const hocuspocusPort = parseInt(process.env.HOCUSPOCUS_PORT || '1235', 10);

const { server, wss, connectionManager } = startServer(port);
const hocuspocus = await startHocuspocusServer(hocuspocusPort);

let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[chord-sync] ${signal} received, shutting down gracefully...`);

  connectionManager.stop();

  for (const client of wss.clients) {
    client.close(1001, 'server shutting down');
  }

  await new Promise<void>((resolve) => {
    wss.close(() => resolve());
  });

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  await hocuspocus.destroy();

  console.log(`[chord-sync] shutdown complete`);
  process.exit(0);
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

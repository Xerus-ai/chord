import { parseArgs } from 'node:util';
import { S3mini } from 's3mini';
import { findBlockmaps, findInstallers, findManifests } from './lib/artifacts.ts';
import { r2Endpoint, requireEnv } from './lib/config.ts';
import { fail, info, step } from './lib/log.ts';
import { publishRelease, uploadOrder } from './lib/upload-order.ts';

const { values } = parseArgs({
  options: {
    channel: { type: 'string' },
    prefix: { type: 'string' },
  },
  strict: true,
});

const s3 = new S3mini({
  accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
  secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  endpoint: r2Endpoint(),
  region: 'auto',
});

const files = {
  installers: findInstallers(values.prefix),
  blockmaps: findBlockmaps(),
  manifests: findManifests(values.channel),
};
const count = uploadOrder(files).length;

if (count === 0) {
  fail('No artifacts found to upload');
}

step(`Uploading ${count} artifact(s) to R2, manifests last`);
await publishRelease(s3, files);
info('All artifacts uploaded to R2');

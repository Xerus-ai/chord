import { randomBytes } from 'node:crypto';

// RFC 9562 UUIDv7: 48-bit unix-ms timestamp, then version/variant bits, then
// randomness. Command ids must sort by insertion order (the inbox executes
// "ascending id" per work item — see the command channel design
// §1/§3), which randomUUID (v4) cannot give and no installed dependency
// provides, so this is hand-rolled here.
//
// Monotonicity within one process: the 12-bit rand_a field is used as a
// counter (RFC 9562 §6.2 method 1) — reseeded randomly on every new
// millisecond with the top bit clear (2048 increments of headroom), and
// incremented for ids minted in the same millisecond, so two commands
// inserted back-to-back never sort equal-timestamp-random-order. Counter
// overflow and clock regression both roll the timestamp forward one ms —
// ordering is what matters here, not sub-ms wall-clock fidelity.

let lastMs = -1;
let counter = 0;

function reseedCounter(): number {
  return randomBytes(2).readUInt16BE(0) & 0x7ff;
}

export function uuidv7(): string {
  let ms = Date.now();
  if (ms > lastMs) {
    lastMs = ms;
    counter = reseedCounter();
  } else {
    ms = lastMs;
    counter += 1;
    if (counter > 0xfff) {
      ms += 1;
      lastMs = ms;
      counter = reseedCounter();
    }
  }

  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(ms, 0, 6);
  bytes[6] = 0x70 | (counter >> 8); // version 7 + counter high nibble
  bytes[7] = counter & 0xff;
  const rand = randomBytes(8);
  bytes[8] = 0x80 | (rand.readUInt8(0) & 0x3f); // variant 10 + 6 random bits
  rand.copy(bytes, 9, 1, 8);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

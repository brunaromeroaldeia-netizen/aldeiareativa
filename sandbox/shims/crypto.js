import { sha256 } from '@noble/hashes/sha2.js';

const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
const toB64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomBytes(n) {
  const u8 = crypto.getRandomValues(new Uint8Array(n));
  return { toString: (enc) => (enc === 'hex' ? toHex(u8) : toB64url(u8)) };
}

export function createHash() {
  const chunks = [];
  const h = {
    update(data) { chunks.push(typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)); return h; },
    digest() {
      const total = chunks.reduce((a, c) => a + c.length, 0);
      const all = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      return toHex(sha256(all));
    },
  };
  return h;
}
export default { randomBytes, createHash };

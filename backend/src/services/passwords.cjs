/* Copyright (c) 2026 Learn With Why. All rights reserved. Proprietary — see LICENSE. This notice may not be removed. */
/* PASSWORDS — Argon2id hashing (OWASP's recommended settings: 19 MiB, 2 passes, 1 lane),
   the password generated at sign-up, and the rule a customer's own password must meet.
   Hashes made by the old SQLite backend (scrypt, "salt:hash") still verify; the server
   re-hashes them with Argon2id at the next successful sign-in. */
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const argon2 = require('argon2');

const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const MAX_LENGTH = 128;   /* longer input is refused before hashing (no hashing-cost attacks) */
const scrypt = promisify(crypto.scrypt);

const hash = password => argon2.hash(String(password), OPTIONS);

async function verify(stored, password) {
  stored = String(stored || ''); password = String(password);
  if (stored.startsWith('$argon2')) { try { return await argon2.verify(stored, password); } catch (_) { return false; } }
  const [salt, key] = stored.split(':');
  if (!salt || !key || !/^[0-9a-f]+$/.test(salt + key)) return false;
  const got = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  const want = Buffer.from(key, 'hex');
  return want.length === got.length && crypto.timingSafeEqual(got, want);
}
const needsRehash = stored => !String(stored).startsWith('$argon2') || argon2.needsRehash(stored, OPTIONS);

/* The generated password: 16 characters in four groups (Kp7m-Qx4r-Tn9w-Bz3h), from an
   alphabet without look-alikes (0/O, 1/l/I) so it can be typed from the email. About 93
   bits of randomness from the OS generator; always has a capital, a small letter and a digit. */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ', LOWER = 'abcdefghijkmnpqrstuvwxyz', DIGITS = '23456789';
const ALPHABET = UPPER + LOWER + DIGITS;
function generate() {
  for (;;) {
    const groups = [];
    for (let g = 0; g < 4; g++) { let s = ''; for (let i = 0; i < 4; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)]; groups.push(s); }
    const p = groups.join('-');
    if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p)) return p;
  }
}

/* the same rule the reset form checks in the browser (utils/format.js strongPass) */
function strength(p) {
  p = String(p == null ? '' : p);
  if (p.length < 8) return 'At least 8 characters.';
  if (p.length > MAX_LENGTH) return 'Too long — ' + MAX_LENGTH + ' characters at most.';
  if (!/[A-Z]/.test(p) || !/[0-9]/.test(p)) return 'Add a capital letter and a number.';
  return '';
}

module.exports = { hash, verify, needsRehash, generate, strength, MAX_LENGTH, OPTIONS };

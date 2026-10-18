
import { env } from './env.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function keyBytes(): Uint8Array {
  const value = env().loginOtpEncryptionKey;
  if (!value) throw new Error('Login OTP encryption is not configured.');

  let raw: Uint8Array;
  try {
    raw = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('Login OTP encryption key must be valid Base64.');
  }

  if (raw.length !== 32) {
    throw new Error('Login OTP encryption key must decode to exactly 32 bytes.');
  }

  return raw;
}

async function deriveKey(label: string, algorithm: 'AES-GCM' | 'HMAC') {
  const material = await crypto.subtle.importKey(
    'raw',
    keyBytes(),
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('learn-with-why-login-otp-v1'),
      info: encoder.encode(label),
    },
    material,
    algorithm === 'AES-GCM'
      ? { name: 'AES-GCM', length: 256 }
      : { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    algorithm === 'AES-GCM' ? ['encrypt', 'decrypt'] : ['sign'],
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateLoginOtp(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const number = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
  return String(number).padStart(6, '0');
}

export async function hashLoginOtp(challengeId: string, code: string): Promise<string> {
  const key = await deriveKey('otp-hmac-v1', 'HMAC');
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${challengeId}:${code}`),
  );
  return toHex(new Uint8Array(signature));
}

export async function encryptLoginSession(value: unknown): Promise<string> {
  const key = await deriveKey('session-aes-gcm-v1', 'AES-GCM');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  );

  return `${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptLoginSession<T>(value: string): Promise<T> {
  const parts = value.split('.');
  if (parts.length !== 2) throw new Error('Invalid encrypted login session.');

  const iv = fromBase64(parts[0]);
  const ciphertext = fromBase64(parts[1]);
  if (iv.length !== 12 || ciphertext.length < 16) {
    throw new Error('Invalid encrypted login session.');
  }

  const key = await deriveKey('session-aes-gcm-v1', 'AES-GCM');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );

  return JSON.parse(decoder.decode(plaintext)) as T;
}

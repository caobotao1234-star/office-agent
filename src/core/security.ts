/**
 * Security utilities — AES-256-GCM encryption/decryption.
 *
 * Used for encrypting sensitive data (API keys, auth tokens)
 * stored on the local filesystem.
 *
 * Requirements: 13.1, 13.2, 13.4
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @param key - 32-byte encryption key (Buffer or hex string)
 * @returns Base64-encoded string containing IV + ciphertext + auth tag
 */
export function encrypt(plaintext: string, key: Buffer | string): string {
  const keyBuf = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
  if (keyBuf.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (256 bits)');
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyBuf, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Pack: IV (12) + authTag (16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt ciphertext produced by `encrypt()`.
 *
 * @param ciphertext - Base64-encoded string from encrypt()
 * @param key - 32-byte encryption key (Buffer or hex string)
 * @returns Decrypted plaintext string
 */
export function decrypt(ciphertext: string, key: Buffer | string): string {
  const keyBuf = typeof key === 'string' ? Buffer.from(key, 'hex') : key;
  if (keyBuf.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (256 bits)');
  }

  const packed = Buffer.from(ciphertext, 'base64');
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid ciphertext: too short');
  }

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, keyBuf, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf-8');
}

/**
 * Generate a random 256-bit encryption key.
 * @returns Hex-encoded 32-byte key string
 */
export function generateKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * age encryption/decryption for backpack sharing.
 *
 * Uses X25519 key pairs. The recipient key is encoded in the share link
 * fragment (#k=...) — never sent to the server.
 */

import {
  generateX25519Identity,
  identityToRecipient,
  Encrypter,
  Decrypter,
} from "age-encryption";

export interface KeyPair {
  /** age secret key (AGE-SECRET-KEY-...) — the "identity" */
  secretKey: string;
  /** age public key (age1...) — the "recipient" */
  publicKey: string;
}

/** Generate a new X25519 key pair. */
export async function generateKeyPair(): Promise<KeyPair> {
  const secretKey = await generateX25519Identity();
  const publicKey = await identityToRecipient(secretKey);
  return { secretKey, publicKey };
}

/** Encrypt plaintext bytes with an age public key. */
export async function encrypt(
  plaintext: Uint8Array,
  publicKey: string,
): Promise<Uint8Array> {
  const e = new Encrypter();
  e.addRecipient(publicKey);
  return await e.encrypt(plaintext);
}

/** Decrypt ciphertext with an age secret key. */
export async function decrypt(
  ciphertext: Uint8Array,
  secretKey: string,
): Promise<Uint8Array> {
  const d = new Decrypter();
  d.addIdentity(secretKey);
  return await d.decrypt(ciphertext);
}

/**
 * Encode a secret key for use in a URL fragment.
 * Uses base64url (no padding) so it's URL-safe.
 */
export function encodeKeyForFragment(secretKey: string): string {
  return btoa(secretKey)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode a secret key from a URL fragment. */
export function decodeKeyFromFragment(fragment: string): string {
  const base64 = fragment.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64);
}

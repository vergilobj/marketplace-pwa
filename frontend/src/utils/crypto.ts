// Client-side E2E encryption for chat using Web Crypto API
// X25519 (ECDH) identity keypair + HKDF → AES-GCM-256 shared key per peer.

const HKDF_INFO = 'marketplace-pwa:chat:v1';
const STORAGE_ID_KEY = 'chat_identity_key'; // один identity на пользователя (не per-user)

interface StoredIdentity {
  privateJwk: JsonWebKey;
  publicRaw: string; // base64 raw X25519 public key (32 bytes)
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const str = atob(b64);
  const buf = new Uint8Array(new ArrayBuffer(str.length));
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(0 + i);
  return buf;
}

// X25519 identity keypair (private key stored as JWK in localStorage)
export async function getOrCreateIdentityKey(): Promise<CryptoKeyPair> {
  const stored = localStorage.getItem(STORAGE_ID_KEY);
  if (stored) {
    const parsed: StoredIdentity = JSON.parse(stored);
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      parsed.privateJwk,
      { name: 'ECDH', namedCurve: 'X25519' },
      true,
      ['deriveBits'],
    );
    const publicKey = await importPeerPublicKey(parsed.publicRaw);
    return { privateKey, publicKey };
  }

  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'X25519' },
    true,
    ['deriveBits'],
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const publicRaw = await exportPublicKeyRaw(kp.publicKey);
  localStorage.setItem(
    STORAGE_ID_KEY,
    JSON.stringify({ privateJwk, publicRaw } satisfies StoredIdentity),
  );
  return kp;
}

export async function exportPublicKeyRaw(publicKey: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', publicKey); // 32 байта
  return toBase64(new Uint8Array(raw));
}

export async function importPeerPublicKey(rawBase64: string): Promise<CryptoKey> {
  const raw = fromBase64(rawBase64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'X25519' },
    false,
    [],
  );
}

export async function deriveSharedKey(
  myPrivate: CryptoKey,
  peerPublic: CryptoKey,
): Promise<CryptoKey> {
  const secret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublic },
    myPrivate,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey('raw', secret, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Формат: base64(IV[12] + ciphertext)
export async function encryptMessage(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return toBase64(combined);
}

export async function decryptMessage(encryptedBase64: string, key: CryptoKey): Promise<string> {
  const combined = fromBase64(encryptedBase64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}
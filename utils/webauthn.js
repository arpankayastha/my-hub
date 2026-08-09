/**
 * Optional WebAuthn (platform authenticator) for profile switching.
 */

function base64UrlToBuffer(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function webAuthnAvailable() {
  return typeof window !== 'undefined'
    && window.PublicKeyCredential
    && typeof navigator?.credentials?.create === 'function';
}

export async function registerPlatformPasskey(userId, displayName) {
  if (!webAuthnAvailable()) throw new Error('webauthn_unavailable');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userIdBytes = new TextEncoder().encode(String(userId));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'My Hub', id: window.location.hostname },
      user: {
        id: userIdBytes,
        name: String(userId),
        displayName: displayName || 'My Hub',
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  });
  if (!credential || credential.type !== 'public-key') throw new Error('webauthn_failed');
  return bufferToBase64Url(credential.rawId);
}

export async function verifyPlatformPasskey(credentialId) {
  if (!webAuthnAvailable()) throw new Error('webauthn_unavailable');
  if (!credentialId) throw new Error('webauthn_not_registered');
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      timeout: 60000,
      userVerification: 'required',
      allowCredentials: [{
        id: base64UrlToBuffer(credentialId),
        type: 'public-key',
      }],
    },
  });
  if (!assertion) throw new Error('webauthn_failed');
  return true;
}

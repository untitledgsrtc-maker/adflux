// =====================================================================
// Supabase Auth MFA wrappers.
//
// Flow:
//   Enrollment (one-time):
//     1. enrollTotp(friendlyName)  → { factorId, qr, secret }
//     2. user scans QR in Authenticator app
//     3. challengeFactor(factorId) → { challengeId }
//     4. verifyChallenge(factorId, challengeId, code) → success
//     5. markEnrolled() updates public.users.totp_enrolled = true
//
//   Step-up (every 15 min):
//     1. listFactors() → find existing TOTP factor
//     2. challengeFactor(factorId) → { challengeId }
//     3. verifyChallenge(factorId, challengeId, code) → success
//     4. authStore.markTotpVerified()
//
// Supabase Auth handles the cryptographic side; our public.users row
// just mirrors `totp_enrolled` for fast UI checks.
// =====================================================================

import { supabase } from './supabase';

/** All MFA factors on the current account (TOTP, webauthn, etc.). */
export async function listFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  // data = { totp: [{ id, friendly_name, status, ... }], phone: [...] }
  return data;
}

/** First verified TOTP factor, or null. */
export async function getVerifiedTotpFactor() {
  const f = await listFactors();
  return (f?.totp ?? []).find((x) => x.status === 'verified') ?? null;
}

/** Begin TOTP enrollment. Returns { factorId, qrCode, secret }. */
export async function enrollTotp(friendlyName = 'Authenticator') {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  });
  if (error) throw error;
  return {
    factorId: data.id,
    qrCode:   data.totp.qr_code,         // SVG markup
    secret:   data.totp.secret,           // base32 — for manual entry
    uri:      data.totp.uri,              // otpauth://… URI
  };
}

/** Issue a challenge for an existing factor. Returns { challengeId }. */
export async function challengeFactor(factorId) {
  const { data, error } = await supabase.auth.mfa.challenge({ factorId });
  if (error) throw error;
  return { challengeId: data.id };
}

/** Verify a 6-digit code against a challenge. Throws on failure. */
export async function verifyChallenge(factorId, challengeId, code) {
  const { data, error } = await supabase.auth.mfa.verify({
    factorId, challengeId, code,
  });
  if (error) throw error;
  return data;
}

/**
 * One-shot helper: challenge + verify for an already-enrolled factor.
 * Used by the step-up screen.
 */
export async function challengeAndVerify(factorId, code) {
  const { challengeId } = await challengeFactor(factorId);
  return verifyChallenge(factorId, challengeId, code);
}

/** Remove an MFA factor (recovery flow / re-enrollment). */
export async function unenrollFactor(factorId) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/** Update public.users.totp_enrolled (best-effort UI hint, not a security boundary). */
export async function markUserTotpEnrolled(enrolled = true) {
  const { error } = await supabase
    .from('users')
    .update({ totp_enrolled: enrolled })
    .eq('id', (await supabase.auth.getUser()).data.user.id);
  if (error) throw error;
}

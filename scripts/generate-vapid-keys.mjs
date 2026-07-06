#!/usr/bin/env node

/**
 * Generates a matching VAPID key pair in the exact formats the app expects
 * (see server/utils/push-protocol.ts): base64url of the raw 65-byte
 * uncompressed P-256 public point and of the raw 32-byte private scalar.
 *
 * The two values MUST always be rotated together — the public key is baked
 * into every push subscription as the applicationServerKey, and workerd
 * validates on every send that the private key pairs with the configured
 * public key ("Invalid EC key in JSON Web Key" when they don't). Rotating
 * either key invalidates all existing subscriptions; installed apps must
 * re-enable notifications afterwards.
 *
 * Usage:
 *   node scripts/generate-vapid-keys.mjs
 *   1. Put the public key into wrangler.jsonc (NUXT_PUBLIC_VAPID_PUBLIC_KEY)
 *      and commit it — CI deploys read the committed file.
 *   2. pnpm exec wrangler secret put NUXT_VAPID_PRIVATE_KEY
 *      (paste the private key; repeat per environment/worker)
 *   3. For local dev, set NUXT_VAPID_PRIVATE_KEY in .dev.vars.
 */

const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
)

const publicKeyBytes = Buffer.from(
  await crypto.subtle.exportKey('raw', keyPair.publicKey),
)
const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)

console.log('NUXT_PUBLIC_VAPID_PUBLIC_KEY (wrangler.jsonc vars, commit it):')
console.log(publicKeyBytes.toString('base64url'))
console.log('')
console.log('NUXT_VAPID_PRIVATE_KEY (worker secret / .dev.vars, never commit):')
console.log(privateJwk.d)

// Centralized, fail-closed resolution of the token-signing secret.
//
// These tokens (e.g. the email-change confirmation link) can change a login
// identity, so signing them with a publicly known default is an account-takeover
// vector. We therefore refuse to run with a weak/absent secret in any
// environment EXCEPT an explicit development/test one. Critically we do NOT gate
// on `NODE_ENV === "production"`: a host that leaves NODE_ENV unset must still
// fail closed rather than silently fall back to a public string.

const INSECURE_SECRETS = new Set(["", "supersecret", "secret", "changeme", "change-me-in-production"])

export function getSigningSecret(): string {
  const secret = process.env.JWT_SECRET ?? ""
  if (INSECURE_SECRETS.has(secret)) {
    const isDev = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
    if (!isDev) {
      throw new Error(
        `JWT_SECRET must be set to a secure random value ` +
        `(NODE_ENV is "${process.env.NODE_ENV ?? "unset"}", not development/test)`
      )
    }
    // Development/test only: a stable, clearly-labeled fallback so local flows work.
    return "dev-insecure-jwt-secret-do-not-use-in-prod"
  }
  return secret
}

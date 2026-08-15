/**
 * Explicit error for the case where a Supabase OAuth identity changed UUID
 * but the verified email already belongs to an existing dSpeak account.
 */
export class EmailIdentityConflictError extends Error {
  constructor(email: string) {
    super(`An account with this email already exists: ${email.slice(0, 3)}***`);
    this.name = "EmailIdentityConflictError";
  }
}

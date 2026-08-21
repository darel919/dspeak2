export class EmailIdentityConflictError extends Error {
  constructor(email: string) {
    super(`An account with this email already exists: ${email.slice(0, 3)}***`);
    this.name = "EmailIdentityConflictError";
  }
}

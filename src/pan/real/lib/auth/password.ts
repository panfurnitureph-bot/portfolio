// Server-side password strength check. The UI validates too, but that is
// bypassable (disable JS / call the action directly) — this is the real gate.
// Returns an error message, or null when the password is acceptable.
export function validatePassword(pw: string): string | null {
  if (typeof pw !== "string" || pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-z]/.test(pw)) return "Password must include a lowercase letter.";
  if (!/[A-Z]/.test(pw)) return "Password must include an uppercase letter.";
  if (!/[0-9]/.test(pw)) return "Password must include a number.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Password must include a special character.";
  return null;
}

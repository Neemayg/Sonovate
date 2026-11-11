// Plain-language text for Supabase Auth errors. Pure, no imports, so it can be
// tested with `node --test`. Codes are Supabase Auth's stable error codes;
// older servers only send a message, so a few messages are matched too.
// Wording never reveals whether an email address has an account, except
// where Supabase itself does (sign-up of an existing address).

const BY_CODE: Record<string, string> = {
  invalid_credentials: "That email and password do not match. Check them and try again.",
  email_not_confirmed: "Confirm your email address first: open the link we sent you, then sign in.",
  user_already_exists: "An account with this email already exists. Sign in instead, or reset your password.",
  email_exists: "An account with this email already exists. Sign in instead, or reset your password.",
  weak_password: "Choose a stronger password: at least 10 characters, ideally a mix of words, numbers and symbols.",
  same_password: "Choose a password different from your current one.",
  over_request_rate_limit: "Too many attempts in a short time. Wait a minute, then try again.",
  over_email_send_rate_limit: "Too many emails sent recently. Wait a few minutes before asking for another one.",
  captcha_failed: "The security check did not pass. Complete it again, then retry.",
  email_address_invalid: "Enter a valid email address.",
  validation_failed: "Check the email address and password, then try again.",
  signup_disabled: "New accounts cannot be created right now.",
  session_not_found: "Your reset link has expired or was already used. Ask for a new one.",
  otp_expired: "Your reset link has expired or was already used. Ask for a new one.",
};

const BY_MESSAGE: [RegExp, string][] = [
  [/invalid login credentials/i, BY_CODE.invalid_credentials],
  [/email not confirmed/i, BY_CODE.email_not_confirmed],
  [/already registered|already exists/i, BY_CODE.user_already_exists],
  [/password should be at least|weak password/i, BY_CODE.weak_password],
  [/rate limit|too many requests/i, BY_CODE.over_request_rate_limit],
  [/captcha/i, BY_CODE.captcha_failed],
  [/failed to fetch|network/i, "Sonovate could not reach the sign-in service. Check your connection and try again."],
];

export function friendlyAuthError(code: string | undefined | null, message: string | undefined | null): string {
  if (code && BY_CODE[code]) return BY_CODE[code];
  for (const [pattern, text] of BY_MESSAGE) if (message && pattern.test(message)) return text;
  return "Something went wrong while signing in. Please try again.";
}

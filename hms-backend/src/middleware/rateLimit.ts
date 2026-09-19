import rateLimit from "express-rate-limit";

/**
 * Throttles login attempts — nothing else stops someone from hammering
 * /auth/login or /platform/auth/login with password guesses otherwise.
 * IP-based (express-rate-limit's default), which is the standard simple
 * approach: not perfect (shared IPs like offices/NAT share one bucket),
 * but a real, meaningful deterrent against credential-stuffing and
 * brute-force attempts, which is what matters here.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts from this network. Wait a few minutes and try again." },
});

/**
 * Slightly more generous than login (legitimate use is much rarer per
 * IP, but a burst of copy-paste retries after a typo shouldn't lock
 * someone out of creating their own account).
 */
export const signupRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signup attempts from this network. Wait a few minutes and try again." },
});

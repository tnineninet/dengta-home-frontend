function displayEmail(user) {
  const email = String(user?.email || "").trim();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email) ||
      /[\p{Cc}\p{Cf}]/u.test(email)) return "";
  return email;
}

/** Public prompt data only; the candidate session stays in the manager. */
export function nativeAuthApprovalDetails({ user, currentUser, recovery }) {
  const email = displayEmail(user);
  if (!email) return null;
  return Object.freeze({ email, currentEmail: displayEmail(currentUser),
    hasCurrentUser: Boolean(currentUser?.id), recovery: recovery === true });
}

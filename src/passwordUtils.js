// Shared password rules/strength logic, kept in one place so the signup
// form and the account "change password" form behave identically.

export const PASSWORD_RULE_TEXT =
  "At least 8 characters, with an uppercase letter, a number, and a special character.";

export function passwordMeetsRules(password) {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

// Returns { score: 0-4, label: "Weak" | "Average" | "Strong", className }
export function getPasswordStrength(password) {
  if (!password) return { score: 0, label: "", className: "" };

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { score, label: "Weak", className: "weak" };
  if (score <= 3) return { score, label: "Average", className: "average" };
  return { score, label: "Strong", className: "strong" };
}

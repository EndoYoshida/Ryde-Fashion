import React, { useState } from "react";
import { Lock, Eye, EyeOff } from "lucide-react";
import { getPasswordStrength } from "../../passwordUtils";

export default function PasswordField({ value, onChange, placeholder = "Password", showStrength = false, autoComplete }) {
  const [visible, setVisible] = useState(false);
  const strength = showStrength ? getPasswordStrength(value) : null;

  return (
    <div>
      <div className="input-wrap">
        <Lock size={15} />
        <input
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {showStrength && value && (
        <div className="password-strength">
          <div className="password-strength-bars">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`password-strength-bar ${i < strength.score ? strength.className : ""}`} />
            ))}
          </div>
          <span className={`password-strength-label ${strength.className}`}>{strength.label}</span>
        </div>
      )}
    </div>
  );
}

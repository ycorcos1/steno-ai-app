import { CSSProperties, FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../lib/auth";

const backgroundStyles: CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "64px 24px",
  background: "radial-gradient(circle at 15% 15%, #1e293b, #0f172a 60%)",
  color: "#e2e8f0",
  fontFamily:
    "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const cardStyles: CSSProperties = {
  width: "100%",
  maxWidth: "420px",
  borderRadius: "22px",
  padding: "40px 36px",
  background:
    "linear-gradient(180deg, rgba(17, 24, 39, 0.92), rgba(17, 24, 39, 0.75))",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  boxShadow:
    "0 35px 55px -35px rgba(15, 23, 42, 0.8), 0 20px 30px -25px rgba(15, 23, 42, 0.7)",
  display: "flex",
  flexDirection: "column",
  gap: "24px",
};

const titleStyles: CSSProperties = {
  fontSize: "26px",
  fontWeight: 700,
  color: "#f8fafc",
  textAlign: "center" as const,
};

const subtitleStyles: CSSProperties = {
  marginTop: "8px",
  fontSize: "14px",
  color: "rgba(203, 213, 225, 0.75)",
  textAlign: "center" as const,
};

const labelStyles: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  fontSize: "14px",
  color: "rgba(226, 232, 240, 0.9)",
};

const inputStyles: CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  borderRadius: "14px",
  border: "1px solid rgba(71, 85, 105, 0.55)",
  background: "rgba(30, 41, 59, 0.65)",
  color: "#f8fafc",
  fontSize: "15px",
  outline: "none",
  transition:
    "border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease",
  boxShadow: "0 8px 16px -12px rgba(148, 163, 184, 0.45)",
};

const buttonStyles = (disabled: boolean): CSSProperties => ({
  marginTop: "8px",
  width: "100%",
  borderRadius: "999px",
  padding: "14px 0",
  fontWeight: 600,
  fontSize: "16px",
  border: "none",
  cursor: disabled ? "not-allowed" : "pointer",
  background: disabled
    ? "linear-gradient(135deg, #059669, #047857)"
    : "linear-gradient(135deg, #10b981, #059669)",
  color: "#052e16",
  transition: "transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease",
  boxShadow: "0 18px 30px -20px rgba(16, 185, 129, 0.55)",
  opacity: disabled ? 0.7 : 1,
});

const errorStyles: CSSProperties = {
  borderRadius: "14px",
  padding: "12px 16px",
  fontSize: "14px",
  color: "#fecdd3",
  background: "rgba(244, 63, 94, 0.08)",
  border: "1px solid rgba(248, 113, 113, 0.35)",
  boxShadow: "0 12px 20px -18px rgba(248, 113, 113, 0.4)",
};

const footerTextStyles: CSSProperties = {
  textAlign: "center" as const,
  fontSize: "14px",
  color: "rgba(203, 213, 225, 0.75)",
};

const linkStyles: CSSProperties = {
  color: "#34d399",
  fontWeight: 600,
};

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login, error, clearError } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    clearError();
    setFormError(null);

    return () => {
      clearError();
    };
  }, [clearError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    clearError();
    setFormError(null);

    if (!email || !password) {
      setFormError("Please enter both email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to sign in.";
      setFormError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayError = formError ?? error;

  return (
    <div style={backgroundStyles}>
      <div style={cardStyles}>
        <div>
          <h1 style={titleStyles}>Sign in to StenoAI</h1>
          <p style={subtitleStyles}>
            Access your documents, templates, and collaborative workspace.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "18px" }}
          noValidate
        >
          <label style={labelStyles}>
            Email
            <input
              style={inputStyles}
              type="email"
              name="email"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={isSubmitting}
              onFocus={(event) => {
                event.currentTarget.style.borderColor =
                  "rgba(16, 185, 129, 0.6)";
                event.currentTarget.style.boxShadow =
                  "0 12px 22px -20px rgba(16, 185, 129, 0.6)";
              }}
              onBlur={(event) => {
                event.currentTarget.style.borderColor =
                  "rgba(71, 85, 105, 0.55)";
                event.currentTarget.style.boxShadow =
                  "0 8px 16px -12px rgba(148, 163, 184, 0.45)";
              }}
            />
          </label>

          <label style={labelStyles}>
            Password
            <input
              style={inputStyles}
              type="password"
              name="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={isSubmitting}
              onFocus={(event) => {
                event.currentTarget.style.borderColor =
                  "rgba(16, 185, 129, 0.6)";
                event.currentTarget.style.boxShadow =
                  "0 12px 22px -20px rgba(16, 185, 129, 0.6)";
              }}
              onBlur={(event) => {
                event.currentTarget.style.borderColor =
                  "rgba(71, 85, 105, 0.55)";
                event.currentTarget.style.boxShadow =
                  "0 8px 16px -12px rgba(148, 163, 184, 0.45)";
              }}
            />
          </label>

          {displayError ? <p style={errorStyles}>{displayError}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting}
            style={buttonStyles(isSubmitting)}
            onMouseEnter={(event) => {
              if (!isSubmitting) {
                event.currentTarget.style.transform = "translateY(-2px)";
                event.currentTarget.style.boxShadow =
                  "0 24px 32px -24px rgba(16, 185, 129, 0.65)";
              }
            }}
            onMouseLeave={(event) => {
              if (!isSubmitting) {
                event.currentTarget.style.transform = "translateY(0)";
                event.currentTarget.style.boxShadow =
                  "0 18px 30px -20px rgba(16, 185, 129, 0.55)";
              }
            }}
          >
            {isSubmitting ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <p style={footerTextStyles}>
          Don’t have an account?{" "}
          <Link to="/signup" style={linkStyles}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;

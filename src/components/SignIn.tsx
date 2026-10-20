import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";

export function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signingIn = flow === "signIn";

  return (
    <div className="auth">
      <div className="auth-head">
        <span className="auth-logo" aria-hidden>
          ♟
        </span>
        <h1>Pawnie</h1>
        <p className="muted">{signingIn ? "Welcome back. Sign in to see your games." : "Create your account to get started."}</p>
      </div>

      <form
        className="card auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const data = new FormData(e.currentTarget);
          data.set("flow", flow);
          try {
            await signIn("password", data);
          } catch {
            setError(signingIn ? "Wrong email or password." : "Couldn't create that account.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="auth-field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
        </div>
        <div className="auth-field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={signingIn ? "current-password" : "new-password"}
            placeholder={signingIn ? "Your password" : "At least 8 characters"}
            minLength={8}
            required
          />
        </div>
        {error && <div className="error">{error}</div>}
        <button className="btn grape auth-submit" type="submit" disabled={busy}>
          {busy ? "One sec..." : signingIn ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="auth-switch muted">
        {signingIn ? "First time here?" : "Already have an account?"}{" "}
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setError(null);
            setFlow(signingIn ? "signUp" : "signIn");
          }}
        >
          {signingIn ? "Create an account" : "Sign in"}
        </button>
      </p>
    </div>
  );
}

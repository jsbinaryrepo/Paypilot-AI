import { useState, type FormEvent } from "react";
import { api } from "../api";

export function AccountPage({ route, onSignedIn }: { route: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const verify = route === "/verify";
  const register = route === "/register";
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (verify) {
        const token = new URLSearchParams(window.location.hash.split("?")[1]).get("token");
        if (!token) throw new Error("Verification link is missing its token.");
        await api("/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
        setMessage("Email verified. Sign in to continue.");
      } else {
        await api(register ? "/auth/register" : "/auth/login", {
          method: "POST", body: JSON.stringify({ email, password }),
        });
        if (register) setMessage("Check your email for a verification link.");
        else onSignedIn();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to complete request.");
    } finally { setBusy(false); }
  }
  return <main className="account-shell">
    <form className="account-card" onSubmit={submit}>
      <a className="brand" href="/">paypilot<span className="brand-ai">AI</span></a>
      <h1>{verify ? "Verify your email" : register ? "Create your account" : "Sign in"}</h1>
      <p className="text-muted">{verify ? "Confirm your email to activate your workspace." : "Your invoices belong to your own account."}</p>
      {!verify && <>
        <label htmlFor="account-email">Email</label>
        <input id="account-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="account-password">Password</label>
        <input id="account-password" type="password" minLength={12} maxLength={128} autoComplete={register ? "new-password" : "current-password"} required value={password} onChange={(event) => setPassword(event.target.value)} />
      </>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Please wait…" : verify ? "Verify email" : register ? "Create account" : "Sign in"}</button>
      {message && <p role="status" className="text-muted">{message}</p>}
      <p className="text-muted">{register || verify ? <a href="#/login">Already registered? Sign in</a> : <a href="#/register">Create an account</a>}</p>
      <a href="/">Back to browser demo</a>
    </form>
  </main>;
}

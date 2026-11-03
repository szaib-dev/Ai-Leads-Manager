"use client";
import { useActionState, useState } from "react";
import { ArrowRight, LockKeyhole, Waves } from "lucide-react";
import { login } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import styles from "./login.module.css";

export function LoginForm({
  next,
  configured,
}: {
  next: string;
  configured: boolean;
}) {
  const [state, action, pending] = useActionState(login, { error: "" });
  const [email, setEmail] = useState("");
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.brand}>
          <span>
            <Waves size={24} />
          </span>
          folio.
        </div>
        <div className={styles.heading}>
          <h1 id="login-title">Welcome back.</h1>
          <p>Sign in to your personal workspace.</p>
        </div>
        {!configured && (
          <div className={styles.notice} role="status">
            Supabase isn’t configured yet. Add the project URL and publishable
            key to your environment, then restart the app.
          </div>
        )}
        <form action={action}>
          <input type="hidden" name="next" value={next} />
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
            maxLength={254}
            disabled={!configured || pending}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            disabled={!configured || pending}
          />
          <div className={styles.error} aria-live="polite">
            {state.error}
          </div>
          <Button
            type="submit"
            className="full-width"
            disabled={!configured || pending}
          >
            {pending ? "Signing in…" : "Sign in"}
            {!pending && <ArrowRight size={16} />}
          </Button>
        </form>
        <p className={styles.private}>
          <LockKeyhole size={13} />
          Private workspace · Manually provisioned accounts
        </p>
      </section>
      <p className={styles.footer}>
        Folio · A focused space for your next conversation.
      </p>
    </main>
  );
}

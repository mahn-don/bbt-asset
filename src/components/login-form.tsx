"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { buttonClass, inputClass } from "@/components/ui";

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(body.error?.message ?? t.t("auth.failed"));
        setPending(false);
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError(t.t("auth.networkError"));
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-line bg-surface p-6 shadow-[var(--shadow-card)]"
    >
      <div className="mb-4">
        <label htmlFor="login-email" className="mb-1.5 block text-[13px] font-medium text-ink">
          {t.t("auth.email")}
        </label>
        <input
          id="login-email"
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
      </div>

      <div className="mb-5">
        <label htmlFor="login-password" className="mb-1.5 block text-[13px] font-medium text-ink">
          {t.t("auth.password")}
        </label>
        <input
          id="login-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
      </div>

      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={buttonClass("primary", "w-full")}>
        {pending ? t.t("auth.signingIn") : t.t("auth.signIn")}
      </button>
    </form>
  );
}

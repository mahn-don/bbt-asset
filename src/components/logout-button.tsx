"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { buttonClass } from "@/components/ui";

export function LogoutButton() {
  const t = useT();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className={buttonClass("ghost", "px-2.5 py-1.5 text-xs")}
    >
      {pending ? t.t("nav.signingOut") : t.t("nav.signOut")}
    </button>
  );
}

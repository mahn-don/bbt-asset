import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { getUiPreferences } from "@/lib/preferences";
import { createTranslator } from "@/lib/i18n/translator";
import { LoginForm } from "@/components/login-form";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  const { locale } = await getUiPreferences();
  const t = createTranslator(locale);

  // If no account exists yet, tell the operator how to create one rather than
  // presenting a form that cannot succeed.
  const userCount = await prisma.user.count();

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="inline-block rounded-md bg-accent px-2 py-1 font-mono text-xs font-bold text-accent-contrast">
            {t.t("app.brandShort")}
          </span>
          <h1 className="type-page-title mt-3">{t.t("app.name")}</h1>
          <p className="type-meta mt-1.5">{t.t("app.tagline")}</p>
        </div>

        {userCount === 0 ? (
          <Notice tone="warning">
            <p>{t.t("auth.noAccountTitle")}</p>
            <pre className="mt-2 overflow-x-auto rounded bg-canvas px-2.5 py-2 font-mono text-xs text-ink-soft">
              npm run admin:create -- you@example.com
            </pre>
          </Notice>
        ) : (
          <LoginForm />
        )}
      </div>
    </div>
  );
}

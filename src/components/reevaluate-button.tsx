"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { buttonClass } from "@/components/ui";

export function ReevaluateButton({ scopeId }: { scopeId: string }) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; message: string | null; error: boolean }>({
    busy: false,
    message: null,
    error: false,
  });

  async function reevaluate() {
    setState({ busy: true, message: null, error: false });

    try {
      const response = await fetch(`/api/assets/${scopeId}/ai-evaluations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        evaluation?: { status?: string; opportunityScore?: number | null };
        error?: { message?: string };
      };

      if (!response.ok) {
        setState({
          busy: false,
          error: true,
          message: body.error?.message ?? t.t("ai.evaluationFailed"),
        });
        return;
      }

      const status = body.evaluation?.status;
      setState({
        busy: false,
        error: status === "FAILED",
        message:
          status === "COMPLETED"
            ? t.t("ai.evaluatedScore", { score: body.evaluation?.opportunityScore ?? "—" })
            : status === "FAILED"
              ? t.t("ai.evaluationFailed")
              : t.t("ai.evaluationQueued"),
      });

      router.refresh();
    } catch {
      setState({ busy: false, error: true, message: t.t("common.networkError") });
    }
  }

  return (
    <div className="flex items-center gap-2">
      {state.message ? (
        <span className={state.error ? "text-[13px] text-danger" : "type-meta"}>
          {state.message}
        </span>
      ) : null}
      <button
        type="button"
        onClick={reevaluate}
        disabled={state.busy}
        className={buttonClass("primary")}
      >
        {state.busy ? t.t("ai.evaluating") : t.t("ai.reevaluate")}
      </button>
    </div>
  );
}

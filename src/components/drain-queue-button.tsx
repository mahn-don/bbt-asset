"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { buttonClass } from "@/components/ui";

/**
 * Processes queued AI jobs on demand.
 *
 * Convenience for local use so the platform runs end to end without a second
 * process; `npm run worker` remains the production path.
 */
export function DrainQueueButton({ pending }: { pending: number }) {
  const t = useT();
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null,
  });

  async function drain() {
    setState({ busy: true, message: null });
    try {
      const response = await fetch("/api/jobs/drain", { method: "POST" });
      const body = (await response.json()) as {
        processed?: number;
        queue?: { pending: number };
        error?: { message: string };
      };

      if (!response.ok) {
        setState({ busy: false, message: t.t("dashboard.queueFailed") });
        return;
      }

      setState({
        busy: false,
        message: t.t("dashboard.processed", {
          processed: body.processed ?? 0,
          pending: body.queue?.pending ?? 0,
        }),
      });
      router.refresh();
    } catch {
      setState({ busy: false, message: t.t("common.networkError") });
    }
  }

  return (
    <div className="flex items-center gap-2">
      {state.message ? <span className="type-meta">{state.message}</span> : null}
      <button
        type="button"
        onClick={drain}
        disabled={state.busy}
        className={buttonClass("primary")}
      >
        {state.busy
          ? t.t("dashboard.processing")
          : t.plural("dashboard.processJobs", pending)}
      </button>
    </div>
  );
}

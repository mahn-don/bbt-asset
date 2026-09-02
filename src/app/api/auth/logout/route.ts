import { NextResponse } from "next/server";
import { destroyCurrentSession } from "@/lib/auth/session";
import { jsonOk, withApi } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout */
export const POST = withApi(async (): Promise<NextResponse> => {
  await destroyCurrentSession();
  return jsonOk({ ok: true });
});

import { after } from "next/server";
import { processRun, validStepToken } from "@/lib/bankReview";

/**
 * 문제 은행 자동 점검을 이어 가는 주소 (점검이 스스로 부른다).
 * 바로 202로 답하고 뒤에서(after) 몇 묶음을 본 뒤, 남으면 다시 이 주소를 부른다.
 * 점검마다 다른 표(SESSION_SECRET 으로 만든 HMAC)가 있어야 한다.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { runId?: unknown };
  const runId = typeof body.runId === "string" ? body.runId.slice(0, 80) : "";
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !validStepToken(runId, auth.slice(7))) return new Response(null, { status: 401 });
  const origin = new URL(request.url).origin;
  after(() => processRun(runId, origin));
  return new Response(null, { status: 202 });
}

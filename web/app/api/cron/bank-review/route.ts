import { after } from "next/server";
import { CRON_SIZE, processRun, startRun } from "@/lib/bankReview";
import { sameSecret } from "@/lib/password";

/**
 * 매주 문제 은행 자동 점검 (vercel.json crons: 월요일 06:00 KST).
 * Vercel 이 `Authorization: Bearer <CRON_SECRET>` 을 붙여 부른다. CRON_SECRET 환경 변수가 없으면 열리지 않는다.
 * 멈춰 있는 점검이 있으면 그것을 이어서 하고, 없으면 새로 시작한다.
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const auth = request.headers.get("authorization") ?? "";
  if (secret.length < 16) return new Response(null, { status: 404 });
  if (!auth.startsWith("Bearer ") || !sameSecret(auth.slice(7), secret)) return new Response(null, { status: 401 });
  const r = await startRun("cron", CRON_SIZE);
  if (r.ok && r.total > 0) {
    const origin = new URL(request.url).origin;
    after(() => processRun(r.runId, origin));
  }
  return Response.json(r);
}

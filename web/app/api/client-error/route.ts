import { logError } from "@/lib/errorLog";
import { getSession } from "@/lib/session";

// 브라우저(학생·선생님 화면)에서 난 오류를 받아 오류 기록에 남긴다. 로그인한 사람만, 작은 글만 받는다.
export async function POST(request: Request) {
  const s = await getSession();
  if (!s) return new Response(null, { status: 401 });
  const text = await request.text();
  if (text.length > 8000) return new Response(null, { status: 413 });
  let body: { message?: unknown; detail?: unknown; place?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  await logError({
    source: "browser",
    place: String(body.place ?? ""),
    message: String(body.message ?? ""),
    detail: String(body.detail ?? ""),
    who: s.role === "teacher" ? "teacher" : s.studentId,
    userAgent: request.headers.get("user-agent") ?? "",
  });
  return new Response(null, { status: 204 });
}

import { db } from "@/lib/db";
import { sameSecret } from "@/lib/password";

/**
 * 정기 문제 점검(Claude 예약 작업)이 문제 은행을 읽어 가는 주소. 읽기만 한다.
 * Vercel 환경 변수 REVIEW_TOKEN(32자 이상)이 있어야 열리고, 요청은
 * `Authorization: Bearer <REVIEW_TOKEN>` 을 보내야 한다. 학생 정보는 내보내지 않는다.
 *
 * GET /api/review/problems?after=<id>&limit=200
 *   → { problems: [...], taxonomy: [...] (첫 쪽만), next: 다음 쪽 after 값 | null }
 * hash 는 문제·정답·해설·분류가 바뀌면 달라져서, 점검한 문제가 고쳐졌는지 알 수 있다.
 */
export async function GET(request: Request) {
  const token = process.env.REVIEW_TOKEN ?? "";
  if (token.length < 32) return new Response(null, { status: 404 });
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !sameSecret(auth.slice(7), token))
    return new Response(null, { status: 401 });

  const url = new URL(request.url);
  const after = (url.searchParams.get("after") ?? "").slice(0, 100);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
  const sql = db();
  const rows = await sql`
    select id, grade, unit, type, frame, difficulty, question, answer, solution, verified, memo,
           created_at,
           md5(concat_ws(chr(1), grade, unit, type, frame, difficulty, question, answer, solution)) as hash
    from problems
    where id > ${after}
    order by id
    limit ${limit + 1}`;
  const more = rows.length > limit;
  const problems = more ? rows.slice(0, limit) : rows;
  const taxonomy = after
    ? undefined
    : await sql`
        select t.grade, t.unit, t.type, t.frame, t.description, count(p.id)::int as problems
        from taxonomy t
        left join problems p on p.grade = t.grade and p.unit = t.unit and p.type = t.type and p.frame = t.frame
        group by t.id order by t.grade, t.unit, t.type, t.frame`;
  return Response.json(
    { problems, taxonomy, next: more ? problems[problems.length - 1].id : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

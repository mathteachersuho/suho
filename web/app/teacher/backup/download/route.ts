import { backupStream } from "@/lib/backup";
import { todaySeoul } from "@/lib/hwFormat";
import { getSession } from "@/lib/session";

// 선생님만. 학생 비밀번호는 원래 값이 아닌 암호화된 값(scrypt)만 들어간다.
export async function GET() {
  if ((await getSession())?.role !== "teacher")
    return new Response("로그인이 필요해요.", { status: 401 });
  return new Response(
    backupStream().pipeThrough(
      new CompressionStream("gzip") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >,
    ),
    {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="suho-backup-${todaySeoul()}.json.gz"`,
        "Cache-Control": "no-store",
      },
    },
  );
}

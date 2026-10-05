import "server-only";
import { headers } from "next/headers";
import { describe, logError } from "./errorLog";
import { whoNow } from "./session";

/** 서버 동작(저장·채점 등)에서 잡은 오류를 콘솔과 오류 기록에 남긴다. 화면에는 원래처럼 친절한 문구를 보여 준다. */
export async function reportError(place: string, err: unknown) {
  console.error(place, err);
  let userAgent = "";
  try {
    userAgent = (await headers()).get("user-agent") ?? "";
  } catch {}
  await logError({ source: "server", place, ...describe(err), who: await whoNow(), userAgent });
}

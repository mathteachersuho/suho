import type { Instrumentation } from "next";

// 서버에서 화면을 그리거나 저장하다가 난 오류를 오류 기록(error_logs)에 남긴다. 선생님 화면 /teacher/errors 에서 본다.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { describe, logError } = await import("./lib/errorLog");
    const { whoFromCookieHeader } = await import("./lib/session");
    const h = (k: string) => {
      const v = request.headers[k];
      return Array.isArray(v) ? v.join("; ") : (v ?? "");
    };
    const d = describe(err);
    const digest = typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : "";
    await logError({
      source: "server",
      place: `${request.method} ${request.path} (${context.routeType}: ${context.routePath})`,
      message: d.message,
      detail: [digest && `digest: ${digest}`, d.detail].filter(Boolean).join("\n"),
      who: await whoFromCookieHeader(h("cookie")),
      userAgent: h("user-agent"),
    });
  } catch (e) {
    console.error("오류 기록 실패", e);
  }
};

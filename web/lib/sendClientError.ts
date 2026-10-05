// 브라우저에서 난 오류를 서버(/api/client-error)로 보낸다. 같은 오류는 한 번만, 한 화면에서 최대 5번까지.
const sent = new Set<string>();

export function sendClientError(err: unknown, kind = "오류") {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
    const message = `${kind}: ${e.name.length > 2 && e.name !== "Error" ? `${e.name}: ` : ""}${e.message}`.slice(0, 1000);
    // 브라우저 확장 프로그램이나 다른 사이트 스크립트에서 난 오류는 이 앱과 상관없어 뺀다
    if (/^(?:.*: )?Script error\.?$/.test(e.message) || /ResizeObserver loop/.test(e.message)) return;
    if (sent.has(message) || sent.size >= 5) return;
    sent.add(message);
    const body = JSON.stringify({ message, detail: (e.stack ?? "").slice(0, 4000), place: location.pathname + location.search });
    fetch("/api/client-error", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
  } catch {
    // 오류 보내기가 실패해도 화면에는 영향이 없게
  }
}

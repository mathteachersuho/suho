import { sendClientError } from "./lib/sendClientError";

// 학생·선생님 브라우저에서 난 오류를 오류 기록으로 보낸다 (선생님 화면 /teacher/errors)
window.addEventListener("error", (event) => {
  // 다른 사이트에서 온 스크립트(확장 프로그램 등)의 오류는 뺀다
  if (event.filename && !event.filename.startsWith(location.origin)) return;
  sendClientError(event.error ?? event.message, "화면 오류");
});
window.addEventListener("unhandledrejection", (event) => sendClientError(event.reason, "처리 안 된 오류"));

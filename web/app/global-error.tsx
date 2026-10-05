"use client";

import { useEffect } from "react";
import { sendClientError } from "@/lib/sendClientError";

// 맨 바깥 틀(layout)에서 난 오류. 이때는 앱 글꼴·색이 없으므로 간단한 모양으로 보여 준다.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    if (!error.digest) sendClientError(error, "화면 오류");
  }, [error]);
  return (
    <html lang="ko">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, padding: 16, textAlign: "center" }}>
        <div>
          <title>오류 · 수학클래스룸</title>
          <p style={{ fontSize: 18, fontWeight: 600 }}>화면을 여는 중에 문제가 생겼어요</p>
          <p style={{ color: "#666" }}>선생님께 자동으로 알려졌어요. 잠시 뒤 다시 시도해 주세요.</p>
          <button type="button" onClick={() => retry()} style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid #ccc", background: "#fff", fontSize: 15 }}>
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}

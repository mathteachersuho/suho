"use client";

import Link from "next/link";
import { useEffect } from "react";
import { sendClientError } from "@/lib/sendClientError";

/**
 * 화면을 그리다 오류가 났을 때 보여 주는 안내. 오류는 선생님 오류 기록에 남는다.
 * (digest 가 있으면 서버에서 난 오류라 서버가 이미 기록했다)
 */
export default function ErrorScreen({ error, retry, home = "/" }: { error: Error & { digest?: string }; retry: () => void; home?: string }) {
  useEffect(() => {
    if (!error.digest) sendClientError(error, "화면 오류");
  }, [error]);
  return (
    <div className="card mx-auto max-w-md space-y-3 text-center">
      <p className="text-lg font-semibold">화면을 여는 중에 문제가 생겼어요</p>
      <p className="text-sm text-ink-soft">선생님께 자동으로 알려졌어요. 다시 시도해 보고, 계속 안 되면 조금 뒤에 들어와 주세요.</p>
      {error.digest && <p className="text-xs text-ink-faint">오류 번호 {error.digest}</p>}
      <div className="flex justify-center gap-2 pt-1">
        <button type="button" className="btn-main" onClick={() => retry()}>
          다시 시도
        </button>
        <Link href={home} className="btn-soft">
          처음으로
        </Link>
      </div>
    </div>
  );
}

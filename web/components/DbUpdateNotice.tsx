/** DB(Supabase)에 앱이 쓰는 표·칸이 빠졌을 때 선생님 화면 위에 띄우는 알림. 누르면 방법이 펼쳐진다. */
export default function DbUpdateNotice({ missing }: { missing: string[] }) {
  return (
    <details className="mb-6 rounded-2xl border border-warn/40 bg-warn-soft px-5 py-3 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warn text-xs font-bold text-white">!</span>
        <span className="flex-1">
          <span className="font-semibold">DB를 업데이트해 주세요.</span> 지금은 <span className="font-medium">{missing.join(", ")}</span> 기능이 저장되지 않아요.
        </span>
        <span className="shrink-0 font-medium text-warn">방법 보기</span>
      </summary>
      <div className="mt-3 space-y-2 border-t border-warn/30 pt-3 text-ink-soft">
        <ol className="list-decimal space-y-1 pl-5">
          <li>Supabase에 로그인해서 수학 앱 프로젝트를 열어요.</li>
          <li>왼쪽 메뉴의 SQL Editor에서 New query를 눌러요.</li>
          <li>
            GitHub 저장소의{" "}
            <a href="https://github.com/mathteachersuho/suho/blob/main/db/schema.sql" target="_blank" rel="noreferrer" className="text-accent underline">
              db/schema.sql
            </a>{" "}
            내용을 전부 복사해서 붙여 넣어요.
          </li>
          <li>Run을 눌러 Success가 나오면 끝이에요. 1분쯤 뒤 새로고침하면 이 알림이 사라져요.</li>
        </ol>
        <p>없는 표와 칸만 새로 만들고 지우는 명령은 없어서, 여러 번 실행해도 학생·문제·숙제 기록은 그대로예요.</p>
      </div>
    </details>
  );
}

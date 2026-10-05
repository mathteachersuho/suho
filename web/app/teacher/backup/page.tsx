import type { Metadata } from "next";
import { IconDownload } from "@/components/Icons";
import { backupAge, backupCounts } from "@/lib/backup";

export const metadata: Metadata = { title: "데이터 백업 · 수학클래스룸" };

const seoul = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(iso));

export default async function BackupPage() {
  const [counts, { at: last, days }] = await Promise.all([backupCounts(), backupAge()]);
  const total = counts.reduce((a, c) => a + (c.count ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Backup</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          데이터 백업
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          학생·문제·숙제·성적·리포트를 모두 파일 하나로 내려받아요. Supabase
          무료 플랜은 자동 백업이 없어서, 일주일에 한 번쯤 받아 두시면 안전해요.
        </p>
      </div>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <a href="/teacher/backup/download" download className="btn-accent">
            <IconDownload />
            전체 백업 받기
          </a>
          <p
            className={`text-sm ${days === null || days >= 7 ? "text-bad" : "text-ink-soft"}`}
          >
            {last
              ? `마지막 백업: ${seoul(last)} (${days === 0 ? "오늘" : `${days}일 전`})`
              : "아직 백업을 받은 적이 없어요."}
          </p>
        </div>
        <ul className="space-y-1 text-sm text-ink-soft">
          <li>
            · 파일 이름은{" "}
            <code className="rounded bg-surface-2 px-1">
              suho-backup-날짜.json.gz
            </code>{" "}
            이에요. 압축을 풀지 않고 그대로 보관하시면 돼요.
          </li>
          <li>
            · 구글 드라이브나 USB처럼 이 컴퓨터 말고 다른 곳에도 한 부 두세요.
          </li>
          <li>
            · 학생 비밀번호는 원래 글자가 아니라 풀 수 없게 바꾼 값으로
            들어가요. 그래도 학생 이름이 있으니 다른 사람에게 보내지 마세요.
          </li>
          <li>
            · 문제가 생겨 되살려야 할 때는 이 파일을 Claude에게 주시면 돼요.
          </li>
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="text-base font-semibold">
          들어가는 기록{" "}
          <span className="font-normal text-ink-faint">
            · 모두 {total.toLocaleString()}줄
          </span>
        </h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
          {counts.map((c) => (
            <div
              key={c.table}
              className="flex justify-between gap-2 border-b border-line py-1.5"
            >
              <dt className="text-ink-soft">{c.label}</dt>
              <dd className="tabular-nums font-medium">
                {c.count === null ? "표 없음" : c.count.toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

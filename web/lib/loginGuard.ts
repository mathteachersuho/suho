import "server-only";
import { headers } from "next/headers";
import { db } from "./db";

// 비밀번호를 계속 넣어 보며 맞히는 것을 막는다.
// 같은 아이디로 10번 틀리면 10분, 같은 인터넷 주소(IP)에서 100번 틀리면 15분 동안 로그인을 막는다.
// (학원 와이파이처럼 여러 학생이 한 주소를 같이 쓰므로 주소 기준은 넉넉하게 둔다.)
// login_attempts 표가 아직 없으면(Supabase에 SQL을 실행하기 전) 막지 않고 그냥 지나간다.

type Rule = { key: string; max: number; minutes: number };

async function ip() {
  const h = await headers();
  return (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

export async function loginRules(kind: "student" | "teacher", id = ""): Promise<Rule[]> {
  const addr = await ip();
  return kind === "teacher"
    ? [{ key: `t:${addr}`, max: 10, minutes: 15 }]
    : [
        { key: `s:${id.toLowerCase().slice(0, 40)}`, max: 10, minutes: 10 },
        { key: `ip:${addr}`, max: 100, minutes: 15 },
      ];
}

const missingTable = (e: unknown) => (e as { code?: string })?.code === "42P01";

/** 막혀 있으면 남은 분을, 아니면 0을 돌려준다. */
export async function lockedMinutes(rules: Rule[]) {
  try {
    const [r] = await db()`
      select ceil(extract(epoch from max(locked_until) - now()) / 60)::int as m
      from login_attempts where key = any(${rules.map((x) => x.key)}) and locked_until > now()`;
    return (r?.m as number | null) ?? 0;
  } catch (e) {
    if (missingTable(e)) return 0;
    throw e;
  }
}

/** 틀린 횟수를 하나 올린다. 마지막으로 틀린 뒤 한참(막는 시간) 지났으면 처음부터 센다. */
export async function recordFailure(rules: Rule[]) {
  try {
    await db()`delete from login_attempts where last_at < now() - interval '1 day'`; // 오래된 기록 정리
    for (const r of rules) {
      await db()`
        insert into login_attempts (key, fails, last_at) values (${r.key}, 1, now())
        on conflict (key) do update set
          fails = case when login_attempts.last_at < now() - make_interval(mins => ${r.minutes}) then 1 else login_attempts.fails + 1 end,
          last_at = now(),
          locked_until = case
            when login_attempts.last_at >= now() - make_interval(mins => ${r.minutes}) and login_attempts.fails + 1 >= ${r.max}
            then now() + make_interval(mins => ${r.minutes}) end`;
    }
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

/** 로그인에 성공하면 그 아이디의 틀린 기록을 지운다 (주소 기록은 그대로 둔다). */
export async function clearFailures(rules: Rule[]) {
  try {
    await db()`delete from login_attempts where key = any(${rules.filter((r) => !r.key.startsWith("ip:")).map((r) => r.key)})`;
  } catch (e) {
    if (!missingTable(e)) throw e;
  }
}

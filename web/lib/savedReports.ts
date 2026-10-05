import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "./db";

/**
 * 저장한 학부모 리포트: 학생·기간마다 하나. 숫자(숙제·시험)는 저장하지 않고 볼 때마다 새로 모은다.
 * 공유 링크는 추측할 수 없는 무작위 토큰(/r/<token>)이고, 끄면 토큰을 지워 예전 링크가 바로 막힌다.
 */
export type SavedReport = {
  id: string;
  studentId: string;
  from: string;
  to: string;
  analysis: string;
  comment: string;
  shareToken: string | null;
  updatedAt: string;
};

export const NOTE_MAX = 6000;
export const TOKEN = /^[A-Za-z0-9_-]{32}$/;

const COLS = "id, student_id, from_date::text, to_date::text, analysis, comment, share_token, to_char(updated_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') as updated_at";

const toSaved = (r: Record<string, unknown>): SavedReport => ({
  id: r.id as string,
  studentId: r.student_id as string,
  from: r.from_date as string,
  to: r.to_date as string,
  analysis: r.analysis as string,
  comment: r.comment as string,
  shareToken: (r.share_token as string | null) ?? null,
  updatedAt: r.updated_at as string,
});

export async function getSavedReport(studentId: string, from: string, to: string) {
  const [r] = await db().unsafe(`select ${COLS} from reports where student_id = $1 and from_date = $2::date and to_date = $3::date`, [studentId, from, to]);
  return r ? toSaved(r) : null;
}

export async function listSavedReports(studentId: string) {
  const rows = await db().unsafe(`select ${COLS} from reports where student_id = $1 order by to_date desc, from_date desc limit 50`, [studentId]);
  return rows.map(toSaved);
}

export async function getSharedReport(token: string) {
  if (!TOKEN.test(token)) return null;
  const [r] = await db().unsafe(`select ${COLS} from reports where share_token = $1`, [token]);
  return r ? toSaved(r) : null;
}

/** 의견을 저장한다 (없으면 만들고, 있으면 고친다). */
export async function saveReport(studentId: string, from: string, to: string, analysis: string, comment: string) {
  const id = `rp_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
  const [r] = await db().unsafe(
    `insert into reports (id, student_id, from_date, to_date, analysis, comment)
     values ($1, $2, $3::date, $4::date, $5, $6)
     on conflict (student_id, from_date, to_date) do update set analysis = excluded.analysis, comment = excluded.comment, updated_at = now()
     returning ${COLS}`,
    [id, studentId, from, to, analysis.slice(0, NOTE_MAX), comment.slice(0, NOTE_MAX)],
  );
  return toSaved(r);
}

/** 공유 링크를 켜거나(새 토큰) 끈다(null). */
export async function setReportShare(studentId: string, id: string, on: boolean) {
  const token = on ? randomBytes(24).toString("base64url") : null;
  const r = await db()`
    update reports set share_token = ${token}, shared_at = ${on ? new Date() : null}
    where id = ${id} and student_id = ${studentId}`;
  return r.count > 0 ? token : undefined;
}

export async function deleteSavedReport(studentId: string, id: string) {
  const r = await db()`delete from reports where id = ${id} and student_id = ${studentId}`;
  return r.count > 0;
}

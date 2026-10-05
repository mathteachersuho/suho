import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { createHash, createHmac } from "node:crypto";
import { getPasswordHash } from "./students";

export type Session = { role: "teacher" } | { role: "student"; studentId: string };

// 비밀번호가 바뀌면 예전 로그인을 끊기 위해, 로그인할 때의 비밀번호 지문(pv)을 쿠키에 함께 넣는다.
// 학생: 저장된 비밀번호 해시의 지문 → 선생님이 새 비밀번호를 만들면 그 학생의 다른 기기 로그인이 끊긴다.
// 선생님: TEACHER_PASSWORD의 지문 → Vercel에서 비밀번호를 바꾸면 모든 선생님 로그인이 끊긴다.
export const studentPv = (hash: string) => createHash("sha256").update(hash).digest("base64url").slice(0, 16);
const teacherPv = () =>
  createHmac("sha256", key())
    .update(process.env.TEACHER_PASSWORD || "")
    .digest("base64url")
    .slice(0, 16);

const COOKIE = "session";
const DAYS = 14;

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET 환경변수(32자 이상)가 필요합니다.");
  return new TextEncoder().encode(secret);
}

/** 학생은 저장된 비밀번호 해시(hash)를 함께 넘긴다. */
export async function createSession(session: Session, hash = "") {
  const expires = new Date(Date.now() + DAYS * 864e5);
  const pv = session.role === "teacher" ? teacherPv() : studentPv(hash);
  const token = await new SignJWT({ ...session, pv })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE);
}

/** 쿠키의 로그인 정보를 확인한다 (한 번의 화면 그리기 안에서는 한 번만 계산). */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] }));
  } catch {
    return null; // 만료됐거나 위조된 쿠키
  }
  if (payload.role === "teacher") return payload.pv === teacherPv() ? { role: "teacher" } : null;
  if (payload.role === "student" && typeof payload.studentId === "string") {
    const hash = await getPasswordHash(payload.studentId); // 지워진 학생이면 null
    if (hash && payload.pv === studentPv(hash)) return { role: "student", studentId: payload.studentId };
  }
  return null;
});

export async function requireTeacher() {
  const s = await getSession();
  if (s?.role !== "teacher") redirect("/login");
  return s;
}

export async function requireStudent() {
  const s = await getSession();
  if (s?.role !== "student") redirect("/login");
  return s;
}

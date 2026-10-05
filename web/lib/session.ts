import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";

export type Session = { role: "teacher" } | { role: "student"; studentId: string };

const COOKIE = "session";
const DAYS = 14;

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET 환경변수(32자 이상)가 필요합니다.");
  return new TextEncoder().encode(secret);
}

export async function createSession(session: Session) {
  const expires = new Date(Date.now() + DAYS * 864e5);
  const token = await new SignJWT({ ...session })
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
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (payload.role === "teacher") return { role: "teacher" };
    if (payload.role === "student" && typeof payload.studentId === "string")
      return { role: "student", studentId: payload.studentId };
  } catch {
    // 만료됐거나 위조된 쿠키
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

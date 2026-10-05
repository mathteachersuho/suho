import "server-only";
import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

// 저장 형식: scrypt$<salt base64>$<hash base64>
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [kind, saltB64, hashB64] = (stored || "").split("$");
  // 예전 Streamlit 방식으로 만든 비밀번호는 여기서 확인할 수 없다 → 선생님이 새 비밀번호를 발급한다.
  if (kind !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** 학생에게 알려 줄 6자리 숫자 비밀번호 */
export function makeTempPassword() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

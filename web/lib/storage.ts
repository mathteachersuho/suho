import "server-only";

/*
 * Supabase 저장소(Storage)에 교재 PDF를 둔다.
 * 큰 PDF가 Vercel(요청 4.5MB·시간 한도)을 거치지 않게, 서버는 '잠깐 쓰는 주소'만 만들어 주고
 * 브라우저가 Supabase 로 바로 올리고(PUT) 바로 읽는다(쪽마다 필요한 부분만).
 * 키(SUPABASE_SERVICE_ROLE_KEY)는 Vercel 환경 변수에만 두고 서버에서만 쓴다.
 */

export const BUCKET = "textbooks";
/** 한 파일 최대 크기. Supabase 무료 플랜은 파일당 50MB 까지라 그보다 크면 Pro 에서 한도를 올려야 한다. */
export const MAX_PDF_BYTES = 500 * 1024 * 1024;

export class StorageError extends Error {}

export function storageConfigured() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function conf() {
  const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new StorageError("Vercel 환경 변수에 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY를 넣어 주세요.");
  return { base: `${url}/storage/v1`, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}

const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

async function call(method: string, path: string, body?: unknown) {
  const { base, headers } = conf();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

let bucketReady = false;
/** 비공개 'textbooks' 통이 없으면 만든다 (처음 한 번) */
async function ensureBucket() {
  if (bucketReady) return;
  const got = await call("GET", `/bucket/${BUCKET}`);
  if (!got.ok) {
    const made = await call("POST", "/bucket", { id: BUCKET, name: BUCKET, public: false, allowed_mime_types: ["application/pdf"] });
    // 동시에 두 번 만들려 하면 '이미 있음'이 날 수 있다
    if (!made.ok && !/exist/i.test(JSON.stringify(made.json))) {
      throw new StorageError(`Supabase 저장소에 교재 통을 만들지 못했어요 (${made.status}). 키가 service_role(secret) 키인지 확인해 주세요.`);
    }
  }
  bucketReady = true;
}

/** 브라우저가 PDF를 바로 올릴 주소 (2시간 동안 한 번 쓸 수 있음) */
export async function signedUploadUrl(path: string): Promise<string> {
  await ensureBucket();
  const r = await call("POST", `/object/upload/sign/${BUCKET}/${enc(path)}`);
  const rel = typeof r.json.url === "string" ? r.json.url : "";
  if (!r.ok || !rel) throw new StorageError(`올릴 주소를 만들지 못했어요 (${r.status}). 잠시 뒤 다시 해 주세요.`);
  return `${conf().base}${rel.startsWith("/") ? rel : `/${rel}`}`;
}

/** 브라우저가 PDF를 읽을 주소 (expiresIn 초 동안) */
export async function signedReadUrl(path: string, expiresIn = 6 * 3600): Promise<string> {
  const r = await call("POST", `/object/sign/${BUCKET}/${enc(path)}`, { expiresIn });
  const rel = typeof r.json.signedURL === "string" ? r.json.signedURL : "";
  if (!r.ok || !rel) throw new StorageError(`교재 파일을 찾지 못했어요 (${r.status}).`);
  return `${conf().base}${rel.startsWith("/") ? rel : `/${rel}`}`;
}

/** 올라간 파일 크기 (없으면 null) */
export async function objectSize(path: string): Promise<number | null> {
  const r = await call("GET", `/object/info/${BUCKET}/${enc(path)}`);
  if (!r.ok) return null;
  const size = Number((r.json.size as number | undefined) ?? (r.json.metadata as { size?: number } | undefined)?.size);
  return Number.isFinite(size) ? size : 0;
}

export async function removeObject(path: string) {
  const r = await call("DELETE", `/object/${BUCKET}`, { prefixes: [path] });
  if (!r.ok) throw new StorageError(`교재 파일을 지우지 못했어요 (${r.status}).`);
}

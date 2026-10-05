import "server-only";

/*
 * Mathpix(사진 → 글자·수식)와 Gemini(문제 만들기) 호출.
 * 키는 Vercel 환경 변수에만 두고 서버에서만 쓴다. 브라우저로는 절대 보내지 않는다.
 */

const MATHPIX_URL = process.env.MATHPIX_URL || "https://api.mathpix.com/v3/text";
const GEMINI_BASE = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

export class AiError extends Error {}

export function aiConfigured() {
  return {
    mathpix: !!(process.env.MATHPIX_APP_ID && process.env.MATHPIX_APP_KEY),
    gemini: !!process.env.GEMINI_API_KEY,
  };
}

function imageMime(b64: string) {
  return b64.startsWith("iVBORw0KGgo") ? "image/png" : "image/jpeg";
}

/** 사진 → 글자. app.py 와 같이 \( \) \[ \] 를 $ / $$ 로 바꿔 돌려준다. */
export async function mathpixText(imageB64: string): Promise<string> {
  const id = process.env.MATHPIX_APP_ID;
  const key = process.env.MATHPIX_APP_KEY;
  if (!id || !key) throw new AiError("Mathpix 키가 설정되지 않았어요. Vercel 환경 변수에 MATHPIX_APP_ID, MATHPIX_APP_KEY를 넣어 주세요.");
  const res = await fetch(MATHPIX_URL, {
    method: "POST",
    headers: { app_id: id, app_key: key, "Content-Type": "application/json" },
    body: JSON.stringify({ src: `data:${imageMime(imageB64)};base64,${imageB64}`, formats: ["text", "latex_styled"] }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || typeof json.text !== "string") throw new AiError("사진에서 글자를 읽지 못했어요. 더 밝고 반듯하게 찍어 다시 해 보세요.");
  return json.text
    .replace(/\\\(\s*/g, "$")
    .replace(/\s*\\\)/g, "$")
    .replace(/\\\[\s*/g, "$$$$")
    .replace(/\s*\\\]/g, "$$$$");
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/** Gemini 한 번 호출 → 글자. 사진을 함께 보내면 사진을 먼저 넣는다. */
export async function gemini(prompt: string, imageB64?: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError("Gemini 키가 설정되지 않았어요. Vercel 환경 변수에 GEMINI_API_KEY를 넣어 주세요.");
  const model = (process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
  const parts: Part[] = [];
  if (imageB64) parts.push({ inline_data: { mime_type: imageMime(imageB64), data: imageB64 } });
  parts.push({ text: prompt });
  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts }] }),
    signal: AbortSignal.timeout(120_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string };
  };
  if (!res.ok) throw new AiError(`Gemini 요청이 실패했어요 (${res.status}). 잠시 뒤 다시 눌러 주세요.`);
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  if (!text.trim()) throw new AiError("Gemini가 빈 답을 보냈어요. 다시 눌러 주세요.");
  return text.trim();
}

export async function geminiJson(prompt: string): Promise<Record<string, unknown>> {
  const text = await gemini(prompt);
  const m = text.match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : {};
  } catch {
    return {};
  }
}

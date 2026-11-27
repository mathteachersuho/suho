// 교재 PDF 보기(pdf.js)에 필요한 파일을 public/pdfjs 로 복사한다. (빌드·개발 시작 전에 자동 실행)
// - 일꾼(worker): PDF를 그리는 일을 화면과 따로 처리
// - cmaps·standard_fonts: 한글 글꼴이 들어 있는 교재 PDF를 제대로 그리는 데 필요
// - wasm·iccs: 일부 이미지 형식(JPEG 2000 등)과 색 정보를 푸는 데 필요
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const out = join(root, "public", "pdfjs");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(src, "legacy", "build", "pdf.worker.min.mjs"), join(out, "pdf.worker.min.mjs"));
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) cpSync(join(src, dir), join(out, dir), { recursive: true });

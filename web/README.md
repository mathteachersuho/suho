# 수학클래스룸 웹앱

Next.js로 만든 학원용 웹앱입니다. 데이터는 Supabase(Postgres)에 저장하고 Vercel에 배포합니다.

## Vercel 설정
- Root Directory: `web`
- 환경변수(Settings → Environment Variables): `DATABASE_URL`, `TEACHER_PASSWORD`, `SESSION_SECRET`, 문제 만들기용 `MATHPIX_APP_ID`, `MATHPIX_APP_KEY`, `GEMINI_API_KEY` (`.env.example` 참고)
- 서버 지역은 `vercel.json`에서 서울(`icn1`)로 정해 두었습니다.

## 내 컴퓨터에서 실행
```bash
cd web
cp .env.example .env.local   # 값을 채운다
npm install
npm run dev
```

import { NextResponse } from "next/server";

// 로그인 정보가 더 이상 맞지 않을 때(예: 지워진 학생) 쿠키를 지우고 로그인 화면으로 보낸다.
export async function GET(request: Request) {
  const res = NextResponse.redirect(new URL("/login", request.url));
  res.cookies.delete("session");
  return res;
}

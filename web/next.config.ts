import type { NextConfig } from "next";

// 모든 화면에 붙이는 보안 헤더
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" }, // 다른 사이트가 이 앱을 몰래 틀(iframe) 안에 넣지 못하게
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // 문제 사진을 서버로 보내기 위해 (브라우저에서 줄여 보내므로 보통 1MB 안팎)
    serverActions: { bodySizeLimit: "6mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;

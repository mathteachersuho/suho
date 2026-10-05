import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 문제 사진을 서버로 보내기 위해 (브라우저에서 줄여 보내므로 보통 1MB 안팎)
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;

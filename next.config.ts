import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": [
      "./chapter-*/**/*.md",
      "./README.md",
      "./Curriculum.md",
      "./Chapter-generation.md",
    ],
  },
};

export default nextConfig;

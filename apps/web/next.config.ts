import { join } from 'node:path';
import type { NextConfig } from 'next';

const apiUrl = process.env.API_URL ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the container image (see Dockerfile).
  ...(process.env.NEXT_OUTPUT === 'standalone' && { output: 'standalone', outputFileTracingRoot: join(__dirname, '../..') }),
  transpilePackages: ['@erp/shared'],
  // Same-origin API proxy so the httpOnly auth cookie works without CORS.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  experimental: { optimizePackageImports: ['@mantine/core', '@tabler/icons-react'] },
};

export default nextConfig;

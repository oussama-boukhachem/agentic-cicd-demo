import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    ppr: true,
    clientSegmentCache: true
  }
};

export default nextConfig;

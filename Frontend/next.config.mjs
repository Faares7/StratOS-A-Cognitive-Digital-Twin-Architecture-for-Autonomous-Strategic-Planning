/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['playwright', 'playwright-core'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'kncxyanhgpmclrsmlard.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;

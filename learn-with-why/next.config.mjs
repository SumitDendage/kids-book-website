/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  turbopack: { root: import.meta.dirname },
};
export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors must fail the build. Ignoring them is how this app shipped a
  // dashboard that rendered fake KPIs: nothing type-checked the difference
  // between a real core response and a demo constant.
  typescript: { ignoreBuildErrors: false },
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;

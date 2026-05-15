/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@notionhq/client"],
  },
};

export default nextConfig;

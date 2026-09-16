/** @type {import('next').NextConfig} */
const nextConfig = {
  // Placeholder SVG images kaya naka-off ang image optimization.
  // Kapag pinalitan mo na ng totoong JPG/PNG photos, pwede mong tanggalin ito.
  images: { unoptimized: true },
};

export default nextConfig;

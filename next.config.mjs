/** @type {import('next').NextConfig} */
const nextConfig = {
  // The weekly-entry store and the integration cache are read/written on the
  // server only. `googleapis` must stay out of the client bundle.
  serverExternalPackages: ['googleapis'],
};

export default nextConfig;

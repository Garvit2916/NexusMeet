/**
 * `API_ORIGIN` enables a same-origin API proxy so browser requests to `/api/*`
 * are forwarded to the FastAPI service. The session cookie then stays
 * first-party, which keeps `SameSite=Lax` working when the frontend and the
 * API are hosted on different domains. Leave it unset for local development:
 * the frontend talks to the API directly through `NEXT_PUBLIC_API_URL`.
 */
const apiOrigin = process.env.API_ORIGIN?.replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  ...(apiOrigin
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
        },
      }
    : {}),
};

export default nextConfig;

/**
 * `API_ORIGIN` enables a same-origin API proxy so browser requests to `/api/*`
 * are forwarded to the FastAPI service. The session cookie then stays
 * first-party, which is what keeps `SameSite=Lax` working.
 *
 * Set it in local development too. Browsers treat `localhost`, `127.0.0.1`, and
 * a LAN address as separate sites, so a cookie set directly by the API is
 * silently dropped when the page is opened on a different one. Routing through
 * the dev server means the cookie is always set on whatever host the browser
 * used, and sign-in works from any of them.
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

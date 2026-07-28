import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// og:image and og:url have to be absolute URLs, and index.html is static — so
// the deployed origin is baked in at build time. Set VITE_SITE_URL in Vercel
// (Settings -> Environment Variables); the fallback only keeps local dev from
// emitting a broken tag.
function siteUrlTags(siteUrl) {
  return {
    name: "makanmatch-site-url",
    transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", siteUrl),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const siteUrl = (env.VITE_SITE_URL || "http://localhost:5173").replace(/\/+$/, "");
  return {
    plugins: [react(), siteUrlTags(siteUrl)],
  };
});

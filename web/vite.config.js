import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { NAME } from "./src/brand.js";

// npm run build writes the site to dist/, which server.py serves.
// npm run dev serves it with hot reload and sends /api to your own server.py on port 8000.
// The product's name lives in src/brand.js; this writes it into index.html, so a rename is one edit.
const brand = { name: "brand", transformIndexHtml: (html) => html.replaceAll("%NAME%", NAME) };

export default defineConfig({
  plugins: [react(), brand],
  // the stylesheet (src/styles/) ships as written: the CSS minifier folded backdrop-filter into -webkit-backdrop-filter, which Chrome ignores
  // three.js is one chunk of about 550 kB that the hero loads after the page has painted (VantaSky.jsx)
  build: { cssMinify: false, chunkSizeWarningLimit: 600 },
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});

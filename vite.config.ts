import { defineConfig } from "vite";
// base './' so the static build works on GitHub Pages (subpath) and Vercel.
export default defineConfig({ base: "./", build: { target: "es2022", chunkSizeWarningLimit: 4000 } });

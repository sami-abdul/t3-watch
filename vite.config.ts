import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const web = new URL("./src/web", import.meta.url).pathname;

// `vite build` makes the page; `vite build --mode app` makes the one-file view MCP hosts embed.
export default defineConfig(({ mode }) => ({
  root: web,
  resolve: { alias: { "~": web } },
  plugins: [react(), tailwindcss(), ...(mode === "app" ? [viteSingleFile()] : [])],
  build:
    mode === "app"
      ? { outDir: "../../dist/app", emptyOutDir: true, rollupOptions: { input: `${web}/app.html` } }
      : { outDir: "../../dist/web", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:8460", "/signin": "http://127.0.0.1:8460" } },
}));

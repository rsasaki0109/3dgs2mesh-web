import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").at(-1);
const base =
  process.env.VITE_BASE ??
  (process.env.GITHUB_ACTIONS && repositoryName
    ? `/${repositoryName}/`
    : "/");

export default defineConfig({
  base,
  plugins: [react()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  server: { host: "127.0.0.1", port: 4173 },
});

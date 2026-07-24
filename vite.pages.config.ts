import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] || "camino-offline";

export default defineConfig({
  base: `/${repositoryName}/`,
  plugins: [react()],
  build: {
    outDir: "github-pages",
    emptyOutDir: true,
  },
});

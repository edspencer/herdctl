import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  root: resolve(__dirname, "src/client"),
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3232",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3232",
        ws: true,
      },
    },
  },
});

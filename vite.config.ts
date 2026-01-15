import path from "path";
import fs from "fs";
import os from "os";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const homeDir = os.homedir();
const certPath = path.resolve(
  homeDir,
  ".office-addin-dev-certs",
  "localhost.crt"
);
const keyPath = path.resolve(
  homeDir,
  ".office-addin-dev-certs",
  "localhost.key"
);

// These certs are only present on dev machines. Never assume they exist in CI/Vercel.
const certsExist = fs.existsSync(certPath) && fs.existsSync(keyPath);

export default defineConfig(({ command }) => {
  const isDevServer = command === "serve";

  const server = isDevServer
    ? {
        port: 3000,
        host: "0.0.0.0",
        https:
          certsExist && !process.env.CI && !process.env.VERCEL
            ? {
                key: fs.readFileSync(keyPath),
                cert: fs.readFileSync(certPath),
              }
            : undefined,
      }
    : undefined;

  return {
    server,
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "index.html"),
          taskpane: path.resolve(__dirname, "taskpane.html"),
        },
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;

            // Keep heavy libraries in their own chunks to reduce the main bundle size.
            if (
              id.includes("mammoth") ||
              id.includes("docxtemplater") ||
              id.includes("pizzip") ||
              id.includes("file-saver")
            ) {
              return "docx";
            }

            if (
              id.includes("@supabase/supabase-js") ||
              id.includes("@supabase")
            ) {
              return "supabase";
            }

            if (id.includes("react") || id.includes("react-dom")) {
              return "react-vendor";
            }

            // Let Rollup decide default chunking for everything else.
            // Forcing a monolithic "vendor" chunk can introduce circular chunk
            // dependencies (e.g., vendor <-> docx) that break ESM initialization.
            return;
          },
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    // Note: Vite automatically loads .env.local and makes VITE_* variables available
    // via import.meta.env. No need to manually inject with define.
  };
});

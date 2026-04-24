import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from "fs";

function serveDataPlugin(): Plugin {
  return {
    name: "serve-data",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const filePath = path.join(
          __dirname,
          "..",
          "data",
          req.url ?? "/on-air.json"
        );
        if (!fs.existsSync(filePath)) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveDataPlugin()],
  build: {
    outDir: "../web",
    emptyOutDir: true,
  },
});

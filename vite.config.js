import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    // Build both desktop and mobile HTML entry points into the same deployment.
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        mobile: resolve(process.cwd(), "mobile.html")
      },
      // Keep pinned Firebase CDN imports external to the Vite bundle.
      external: [/^https:\/\/www\.gstatic\.com\/firebasejs\/12\.19\.0\//]
    }
  }
});

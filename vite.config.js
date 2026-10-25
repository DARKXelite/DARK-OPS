import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      // Keep pinned Firebase CDN imports external to the Vite bundle.
      external: [/^https:\/\/www\.gstatic\.com\/firebasejs\/12\.19\.0\//]
    }
  }
});

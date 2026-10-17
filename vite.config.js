import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      // Firebase remains on the same pinned browser SDK URL as the baseline.
      external: [/^https:\/\/www\.gstatic\.com\/firebasejs\/10\.7\.1\//]
    }
  }
});

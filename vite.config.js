import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js lives in its own lazily-loaded chunk; ~540 kB raw / ~136 kB gzip is expected
    chunkSizeWarningLimit: 700,
  },
});

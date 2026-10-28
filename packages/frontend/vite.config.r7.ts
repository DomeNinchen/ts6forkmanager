import { mergeConfig } from 'vite';
import base from './vite.config';

// Untracked test-rig config (R7): own port pair, deleted before committing.
export default mergeConfig(base, {
  server: {
    port: 5191,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3091' },
      '/ws': { target: 'ws://localhost:3091', ws: true },
    },
  },
});

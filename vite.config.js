import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/v2/creator-bridge": {
        target: "http://127.0.0.1:18088",
        changeOrigin: true,
      },
      "/api/v2/local-agent": {
        target: "http://127.0.0.1:18088",
        changeOrigin: true,
      },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-core",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: "supabase-auth",
              test: /node_modules[\\/]@supabase[\\/]auth-js[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})

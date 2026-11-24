import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5179,
    host: '127.0.0.1',
    proxy: {
      '/api': 'http://127.0.0.1:5178'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        toast: 'toast.html',
        focus: 'focus.html'
      }
    }
  }
})

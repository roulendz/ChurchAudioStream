import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "generateSW",
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^\/ws\//,
            handler: "NetworkOnly",
          },
        ],
      },
      manifest: {
        name: "Church Audio Stream",
        short_name: "CAS",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        // TODO: Replace placeholder icons with real CAS-branded icons
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
    }),
  ],
  build: {
    outDir: "../sidecar/public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "https://localhost:7777",
        secure: false,
        changeOrigin: true,
      },
      "/ws": {
        target: "https://localhost:7777",
        secure: false,
        ws: true,
        changeOrigin: true,
      },
    },
  },
});

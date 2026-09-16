import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  // DEV SERVER ONLY — none of this affects `vite build` or production.
  //
  // Vite rejects any request whose Host header it doesn't recognise (a
  // DNS-rebinding protection), which means a dev server running in a cloud
  // sandbox is unreachable by default: v0 serves this app from a
  // *.vercel.run host and the preview showed "Blocked request. This host is
  // not allowed."
  //
  // A leading dot allows a domain and all of its subdomains, so this covers
  // whichever sandbox host v0 hands out on a given run rather than pinning one.
  server: {
    allowedHosts: [".vercel.run", ".vercel.app"],
  },
});

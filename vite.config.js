import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Pages are lazy-loaded in App.jsx, so Vite already splits the bundle per page.
export default defineConfig({
  plugins: [react()],
});

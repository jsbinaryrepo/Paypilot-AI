import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "client",
  base: "/owner/",
  plugins: [tailwindcss()],
  define: { "import.meta.env.VITE_PUBLIC_DEMO": JSON.stringify("false") },
  build: { outDir: "../dist/owner-client", emptyOutDir: true },
});

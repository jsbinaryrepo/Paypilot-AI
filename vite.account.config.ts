import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "client",
  base: "/app/",
  plugins: [tailwindcss()],
  define: {
    "import.meta.env.VITE_PUBLIC_DEMO": JSON.stringify("false"),
    "import.meta.env.VITE_GUEST_MODE": JSON.stringify("false"),
    "import.meta.env.VITE_ACCOUNT_MODE": JSON.stringify("true"),
  },
  build: { outDir: "../dist/account-client", emptyOutDir: true },
});

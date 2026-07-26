import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/RubikAlgorithmFlowDeveloper/", // MUST match repo name exactly (case-sensitive)
});

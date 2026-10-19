import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // "./" makes every file path relative, so the built site works at
  // https://username.github.io/any-repo-name/ without hard-coding the repo name.
  base: "./",
});

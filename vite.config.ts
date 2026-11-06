import { defineConfig } from "vite";
import { workshopSavePlugin } from "./scripts/workshop-save-plugin";

export default defineConfig({
  plugins: [workshopSavePlugin()],
});

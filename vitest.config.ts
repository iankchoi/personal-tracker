import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // Pin the test process's timezone to UTC — the timezone Vercel's Node
    // runtime uses in production. Without this, date math that reads an
    // event's wall clock through the runtime's local accessors (rather than
    // the event's own UTC offset) passes on a developer machine set to
    // US/Eastern, where it happens to match the test fixtures' `-04:00`,
    // while silently breaking on deploy. Any such regression now fails here.
    env: { TZ: "UTC" },
    server: {
      deps: {
        inline: ["next-auth", "@auth/core"],
      },
    },
  },
});

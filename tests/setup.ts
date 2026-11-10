import "@testing-library/jest-dom/vitest";

import { config } from "dotenv";

config({ path: ".env.test" });

if (typeof Element !== "undefined") {
  Element.prototype.setPointerCapture ??= function () {};
  Element.prototype.releasePointerCapture ??= function () {};
}

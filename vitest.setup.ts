import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// CSS Module class names are scoped (`_card_5a2c5d`), so assert on roles and
// accessible state rather than exact class strings.
afterEach(cleanup);

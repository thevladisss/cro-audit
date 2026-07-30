---
name: ui-component
description: Create a new UI component in app/components/ui/ that matches the existing house conventions (CSS Modules + token knobs, ComponentPropsWithRef props, barrel exports). Use when the user asks for a new UI primitive — "add a Select", "make a Badge component", "we need a Modal", "generate a UI component" — or wants an existing one in app/components/ui/ extended in the same style.
---

# Generate a UI component

Builds one component under `app/components/ui/<Name>/` that is indistinguishable in style from `Button`, `TextField`, `TextArea`, and `Card`.

## 1. Ask what they want

Unless the request already pins all of it down, use **AskUserQuestion** (one call, batch the questions) to settle:

- **Which component** — if the name is vague or absent. Offer plausible primitives that don't exist yet (Select, Checkbox, Badge, Modal, Tooltip, Switch, Alert…). Check `app/components/ui/` first so you never offer one that already exists.
- **Variants / sizes** — the visual axes it needs (e.g. `variant`, `size`, `tone`), or none.
- **Behavior worth deciding** — only when a real fork exists: controlled vs. uncontrolled, compound sub-components (Card-style `X` + `XHeader` + `XBody`) vs. a single element, portal vs. inline.

Don't ask about anything the conventions below already answer — file layout, class-merge style, token naming, export shape. Those are settled.

## 2. Read before writing

- The two closest existing components in `app/components/ui/` — the `.tsx` **and** the `.module.css`. Follow the nearest neighbor, not this file's summary, wherever they disagree.
  - Wrapper + label + message + a11y wiring → `TextField`, `TextArea`
  - Variants/sizes on a single element → `Button`
  - Polymorphic `as` prop or compound sub-components → `Card`
- `app/globals.css` — the `--ui-*` token list. Never invent a token that isn't there.
- Per `AGENTS.md`, this is Next.js 16 with breaking changes from what you may remember: read the relevant guide in `node_modules/next/dist/docs/` before using any Next API.

## 3. File layout

```
app/components/ui/<Name>/
  <Name>.tsx
  <Name>.module.css
  <Name>.test.tsx
  index.ts
```

The test file is not optional — a component isn't done until it ships with one. See §6.

`<Name>/index.ts` re-exports the value(s), `default`, and the types:

```ts
export { Badge, default } from "./Badge";
export type { BadgeProps, BadgeVariant } from "./Badge";
```

Then append to `app/components/ui/index.ts` — same shape but **no `default`** there, value exports first, then a `export type { … }` block with the type names sorted alphabetically.

## 4. TSX conventions

- `"use client"` **only** if the component uses hooks, state, or event-handler-driven behavior of its own. `Button` and `Card` are server components; `TextField`/`TextArea` are clients because of `useId`. Don't add it reflexively.
- Props are `ComponentPropsWithRef<"tag"> & { …extras }`. Omit conflicting DOM props: `Omit<ComponentPropsWithRef<"input">, "size">` when you add your own `size`. No `forwardRef` — React 19 passes `ref` through as a normal prop.
- Named function export, then `export default <Name>;` at the bottom.
- Destructure every custom prop plus `className`, give defaults inline (`variant = "primary"`), spread `...props` last onto the element.
- Class merging is always this inline expression — no `clsx`, no helper:

  ```tsx
  className={[styles.root, styles[variant], flag && styles.flag, className]
    .filter(Boolean)
    .join(" ")}
  ```

  The consumer's `className` goes **last**. When a union value doesn't map 1:1 to a class name, use a `Record<Union, string>` lookup at module scope like `Card`'s `paddingClass`.
- Wrapper components (a root `<div>` around a control) put the consumer's `className` on the **control** and expose `containerClassName` for the root, documented with `/** Applied to the wrapper, not the <input>. */`.
- Accessibility is not optional:
  - `const id = providedId ?? useId()`; derive `const messageId = \`${id}-message\``.
  - `aria-invalid={error ? true : undefined}`, `aria-describedby={message ? messageId : undefined}`, `aria-busy={loading || undefined}` — always `undefined`, never `false`.
  - Decorative nodes get `aria-hidden`.
  - Error text replaces the hint: `const message = error ?? hint;`
- JSDoc `/** … */` on any prop whose purpose isn't obvious from its name. Skip it on `variant`, `size`, `fullWidth`.

## 5. CSS module conventions

- First line is `/* Public knobs: --<kebab-name>-* */`, matching `--button-*`, `--text-field-*`, `--card-*`.
- Declare every private var on the root class as a three-level chain — **component knob → global token → hard fallback**:

  ```css
  --_bg: var(--badge-bg, var(--ui-surface, #ffffff));
  --_radius: var(--badge-radius, var(--ui-radius, 10px));
  ```

  Base rules read only `var(--_x)`. A knob with no matching `--ui-*` token still gets its literal fallback (`--_height: var(--badge-height, 24px)`).
- Variants and sizes **only re-point the knobs** — they never redeclare layout properties. Group them under `/* Variants */` and `/* Sizes */` comments.
- Class names are camelCase (`fullWidth`, `errorMessage`, `paddingSm`), matching what the TSX reads off `styles`.
- Use logical properties: `padding-inline`, `margin-inline-start`, `inset-inline-*`.
- State selectors follow the existing patterns: `:hover:not(:disabled)`, `:focus-visible` with `outline: var(--_focus-width) solid var(--_focus-color)` plus an `outline-offset`, `:disabled { opacity: var(--_disabled-opacity); cursor: not-allowed; }`.
- Transitions list properties explicitly with `var(--_transition)`. Any file with a transition or animation ends with:

  ```css
  @media (prefers-reduced-motion: reduce) {
    .root {
      transition: none;
    }
  }
  ```

- Tailwind v4 is installed but the UI primitives don't use it. Stay in CSS Modules.

### Tokens available in `app/globals.css`

`--ui-surface`, `--ui-surface-muted`, `--ui-text`, `--ui-text-muted`, `--ui-border`, `--ui-accent`, `--ui-accent-hover`, `--ui-accent-text`, `--ui-danger`, `--ui-danger-text`, `--ui-focus`, `--ui-radius-sm`, `--ui-radius`, `--ui-radius-lg`, `--ui-font`, `--ui-transition`.

Each has a dark-mode value under `@media (prefers-color-scheme: dark)`. Because colors resolve through these tokens, a correctly written component gets dark mode for free — **never** add a `prefers-color-scheme` block to a component's module. If a needed color has no token, use `color-mix(in oklab, var(--ui-…) …%, black)` off an existing one, the way `Button`'s `.danger` hover does.

## 6. Tests — required

Every component ships `<Name>.test.tsx` beside its source. Stack is Vitest + React Testing Library (`vitest.config.mts`, `vitest.setup.ts` at the repo root). Read the closest existing test file before writing — `Button.test.tsx` for a single element, `TextField.test.tsx` for label/message/a11y wiring, `Card.test.tsx` for polymorphic and compound components.

Shape:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New")).toBeInTheDocument();
  });
});
```

**Query by role and accessible name first** (`getByRole("button", { name: "Save" })`, `getByLabelText(/Email/)`). Reach for `getByText` only for non-interactive content, and `data-testid` only as a last resort.

**Assert behaviour and accessible state, not CSS.** Vitest scopes CSS Module class names, so `styles.elevated` renders as `_elevated_5a2c5d` — never assert an exact class string. Test that the consumer's `className` survives with `toHaveClass("custom")`, and if a purely visual variant has no other observable surface, match the readable stem with a regex (`expect(el.className).toMatch(/elevated/)`) the way `Card.test.tsx` does.

Cover, as applicable to the component:

- **Render + defaults** — children appear; defaulted props land (`type="button"`, `rows={4}`, `variant="primary"`).
- **Each variant/size prop** is accepted and produces a distinct class.
- **Interaction** — `userEvent.setup()`, then click/type/keyboard. Assert handlers fire with `vi.fn()`.
- **Disabled / loading / readOnly** — the handler does *not* fire, and the element reports the right state (`toBeDisabled()`).
- **Accessibility wiring** — label↔control association, `aria-invalid`, `aria-describedby` pointing at the real message id, `aria-busy`, `aria-hidden` on decorations. Assert the negative too: these attributes must be *absent* (`not.toHaveAttribute`) when the state is off, since the components use `undefined` rather than `false`.
- **Generated vs. provided `id`** — two instances get distinct ids; an explicit `id` wins.
- **`className` passthrough**, and for wrapper components that `containerClassName` lands on the root while `className` lands on the control.
- **`ref` forwarding** to the underlying element.
- **Polymorphism** — `as="article"`, `as="a"` with `href`, and `CardTitle`-style heading levels via `getByRole("heading", { level: 2 })`.

Only test what the component actually promises. `TextArea`'s counter derives from props, so it tracks a controlled `value` via `rerender` — don't write a test that types into an uncontrolled field and expects the counter to move.

## 7. Verify

Run all three; all must be clean before you report back:

```bash
npm test
npx tsc --noEmit
npm run lint
```

> **Node version:** `jsdom@30` requires Node `^22.22.2 || ^24.15.0 || >=26.0.0`. On an older Node, `npm test` dies at startup with `ERR_REQUIRE_ESM` from `html-encoding-sniffer`. That's an environment problem, not a broken test — switch Node (`nvm use 24`) rather than editing the suite.

Then tell the user, briefly: the files added, the props/variants exposed, the `--<name>-*` knobs, what the tests cover, and a short usage snippet.

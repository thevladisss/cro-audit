import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./Button";

describe("Button", () => {
  it("renders its children and defaults to type=button", () => {
    render(<Button>Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
  });

  it("respects an explicit type", () => {
    render(<Button type="submit">Send</Button>);

    expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("calls onClick when pressed", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Press</Button>);

    await user.click(screen.getByRole("button", { name: "Press" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled and busy while loading, and swallows clicks", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("omits aria-busy when not loading", () => {
    render(<Button>Idle</Button>);

    expect(screen.getByRole("button", { name: "Idle" })).not.toHaveAttribute(
      "aria-busy",
    );
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Off
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Off" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the consumer className alongside its own", () => {
    render(<Button className="custom">Styled</Button>);

    const button = screen.getByRole("button", { name: "Styled" });
    expect(button).toHaveClass("custom");
    expect(button.className.split(" ").length).toBeGreaterThan(1);
  });

  it("forwards ref to the underlying button", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Ref</Button>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("passes arbitrary button props through", () => {
    render(<Button aria-label="Close dialog" name="close" />);

    const button = screen.getByRole("button", { name: "Close dialog" });
    expect(button).toHaveAttribute("name", "close");
  });
});

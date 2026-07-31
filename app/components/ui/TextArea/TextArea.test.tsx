import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TextArea } from "./TextArea";

describe("TextArea", () => {
  it("associates the label with the textarea", () => {
    render(<TextArea label="Bio" />);

    expect(screen.getByLabelText(/Bio/)).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("defaults to four rows", () => {
    render(<TextArea label="Bio" />);

    expect(screen.getByLabelText(/Bio/)).toHaveAttribute("rows", "4");
  });

  it("honours an explicit row count", () => {
    render(<TextArea label="Bio" rows={8} />);

    expect(screen.getByLabelText(/Bio/)).toHaveAttribute("rows", "8");
  });

  it("links the hint through aria-describedby", () => {
    render(<TextArea label="Bio" hint="Max 200 characters." />);

    const textarea = screen.getByLabelText(/Bio/);
    const hint = screen.getByText("Max 200 characters.");

    expect(textarea).toHaveAttribute("aria-describedby", hint.id);
  });

  it("marks the field invalid and shows the error instead of the hint", () => {
    render(<TextArea label="Bio" hint="Optional." error="Too long." />);

    expect(screen.getByLabelText(/Bio/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Too long.")).toBeInTheDocument();
    expect(screen.queryByText("Optional.")).not.toBeInTheDocument();
  });

  it("marks the textarea required and renders a decorative asterisk", () => {
    render(<TextArea label="Bio" required />);

    expect(screen.getByLabelText(/Bio/)).toBeRequired();
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden");
  });

  it("shows a counter when showCount is paired with maxLength", () => {
    render(<TextArea label="Bio" maxLength={100} showCount value="hello" readOnly />);

    expect(screen.getByText("5/100")).toBeInTheDocument();
  });

  it("counts an uncontrolled defaultValue", () => {
    render(
      <TextArea label="Bio" maxLength={100} showCount defaultValue="abc" />,
    );

    expect(screen.getByText("3/100")).toBeInTheDocument();
  });

  it("does not show a counter without maxLength", () => {
    render(<TextArea label="Bio" showCount value="hello" readOnly />);

    expect(screen.queryByText(/\/\d+$/)).not.toBeInTheDocument();
  });

  // The counter reads from props, so it tracks a controlled `value` — that is
  // the documented contract, and typing into an uncontrolled field won't move it.
  it("follows a controlled value", () => {
    const { rerender } = render(
      <TextArea label="Bio" maxLength={100} showCount value="hi" readOnly />,
    );
    expect(screen.getByText("2/100")).toBeInTheDocument();

    rerender(
      <TextArea label="Bio" maxLength={100} showCount value="hello" readOnly />,
    );
    expect(screen.getByText("5/100")).toBeInTheDocument();
  });

  it("accepts typed input", async () => {
    const user = userEvent.setup();
    render(<TextArea label="Bio" />);

    const textarea = screen.getByLabelText(/Bio/);
    await user.type(textarea, "hello");

    expect(textarea).toHaveValue("hello");
  });

  it("puts className on the textarea and containerClassName on the wrapper", () => {
    const { container } = render(
      <TextArea
        label="Bio"
        className="area-custom"
        containerClassName="wrapper-custom"
      />,
    );

    expect(screen.getByLabelText(/Bio/)).toHaveClass("area-custom");
    expect(container.firstElementChild).toHaveClass("wrapper-custom");
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TextField } from "./TextField";

describe("TextField", () => {
  it("associates the label with the input", () => {
    render(<TextField label="Email" />);

    expect(screen.getByLabelText(/Email/)).toBeInstanceOf(HTMLInputElement);
  });

  it("defaults to type=text", () => {
    render(<TextField label="Email" />);

    expect(screen.getByLabelText(/Email/)).toHaveAttribute("type", "text");
  });

  it("generates a unique id when none is given", () => {
    render(
      <>
        <TextField label="First" />
        <TextField label="Second" />
      </>,
    );

    const first = screen.getByLabelText("First");
    const second = screen.getByLabelText("Second");

    expect(first.id).toBeTruthy();
    expect(first.id).not.toBe(second.id);
  });

  it("uses a provided id instead of the generated one", () => {
    render(<TextField label="Email" id="email-field" />);

    expect(screen.getByLabelText(/Email/)).toHaveAttribute("id", "email-field");
  });

  it("links the hint through aria-describedby", () => {
    render(<TextField label="Email" hint="We never share it." />);

    const input = screen.getByLabelText(/Email/);
    const hint = screen.getByText("We never share it.");

    expect(input).toHaveAttribute("aria-describedby", hint.id);
  });

  it("marks the field invalid and shows the error instead of the hint", () => {
    render(
      <TextField label="Email" hint="We never share it." error="Required." />,
    );

    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Required.")).toBeInTheDocument();
    expect(screen.queryByText("We never share it.")).not.toBeInTheDocument();
  });

  it("omits aria-invalid when there is no error", () => {
    render(<TextField label="Email" />);

    expect(screen.getByLabelText(/Email/)).not.toHaveAttribute("aria-invalid");
  });

  it("omits aria-describedby when there is no message", () => {
    render(<TextField label="Email" />);

    expect(screen.getByLabelText(/Email/)).not.toHaveAttribute(
      "aria-describedby",
    );
  });

  it("marks the input required and renders a decorative asterisk", () => {
    render(<TextField label="Email" required />);

    const input = screen.getByLabelText(/Email/);
    expect(input).toBeRequired();

    const asterisk = screen.getByText("*");
    expect(asterisk).toHaveAttribute("aria-hidden");
  });

  it("accepts typed input", async () => {
    const user = userEvent.setup();
    render(<TextField label="Email" />);

    const input = screen.getByLabelText(/Email/);
    await user.type(input, "hi@example.com");

    expect(input).toHaveValue("hi@example.com");
  });

  it("puts className on the input and containerClassName on the wrapper", () => {
    const { container } = render(
      <TextField
        label="Email"
        className="input-custom"
        containerClassName="wrapper-custom"
      />,
    );

    expect(screen.getByLabelText(/Email/)).toHaveClass("input-custom");
    expect(container.firstElementChild).toHaveClass("wrapper-custom");
    expect(container.firstElementChild).not.toHaveClass("input-custom");
  });

  it("renders without a label", () => {
    render(<TextField placeholder="Search" />);

    expect(screen.getByPlaceholderText("Search")).toBeInTheDocument();
  });
});

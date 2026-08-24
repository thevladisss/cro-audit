import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Dropdown, type DropdownOption } from "./Dropdown";

const options: DropdownOption[] = [
  { label: "United States", value: "us" },
  { label: "Ukraine", value: "ua" },
  { label: "Japan", value: "jp", disabled: true },
];

describe("Dropdown", () => {
  it("associates the label with the select", () => {
    render(<Dropdown label="Country" options={options} />);

    expect(screen.getByLabelText(/Country/)).toBeInstanceOf(HTMLSelectElement);
  });

  it("renders an option per entry", () => {
    render(<Dropdown label="Country" options={options} />);

    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(
      screen.getByRole("option", { name: "United States" }),
    ).toBeInTheDocument();
  });

  it("disables individual options", () => {
    render(<Dropdown label="Country" options={options} />);

    expect(screen.getByRole("option", { name: "Japan" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "Ukraine" })).not.toBeDisabled();
  });

  it("renders a disabled placeholder that rests as the selection", () => {
    render(
      <Dropdown label="Country" placeholder="Select one…" options={options} />,
    );

    const placeholder = screen.getByRole("option", { name: "Select one…" });
    expect(placeholder).toBeDisabled();
    expect(screen.getByLabelText(/Country/)).toHaveValue("");
  });

  it("omits the placeholder option when none is given", () => {
    render(<Dropdown label="Country" options={options} />);

    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.getByLabelText(/Country/)).toHaveValue("us");
  });

  it("accepts children for optgroup markup", () => {
    render(
      <Dropdown label="Country">
        <optgroup label="Europe">
          <option value="ua">Ukraine</option>
        </optgroup>
      </Dropdown>,
    );

    expect(screen.getByRole("option", { name: "Ukraine" })).toBeInTheDocument();
  });

  it("selects an option and fires onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Dropdown
        label="Country"
        placeholder="Select one…"
        options={options}
        onChange={onChange}
      />,
    );

    const select = screen.getByLabelText(/Country/);
    await user.selectOptions(select, "ua");

    expect(select).toHaveValue("ua");
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("honours a controlled value", () => {
    const noop = () => {};
    const { rerender } = render(
      <Dropdown label="Country" options={options} value="us" onChange={noop} />,
    );
    expect(screen.getByLabelText(/Country/)).toHaveValue("us");

    rerender(
      <Dropdown label="Country" options={options} value="ua" onChange={noop} />,
    );
    expect(screen.getByLabelText(/Country/)).toHaveValue("ua");
  });

  it("does not fire onChange when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Dropdown label="Country" options={options} disabled onChange={onChange} />,
    );

    const select = screen.getByLabelText(/Country/);
    expect(select).toBeDisabled();

    await user.click(select);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("links the hint through aria-describedby", () => {
    render(
      <Dropdown label="Country" options={options} hint="Where you're billed." />,
    );

    const select = screen.getByLabelText(/Country/);
    const hint = screen.getByText("Where you're billed.");

    expect(select).toHaveAttribute("aria-describedby", hint.id);
  });

  it("marks the field invalid and shows the error instead of the hint", () => {
    render(
      <Dropdown
        label="Country"
        options={options}
        hint="Where you're billed."
        error="Pick a country."
      />,
    );

    expect(screen.getByLabelText(/Country/)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByText("Pick a country.")).toBeInTheDocument();
    expect(screen.queryByText("Where you're billed.")).not.toBeInTheDocument();
  });

  it("omits aria-invalid and aria-describedby when clean", () => {
    render(<Dropdown label="Country" options={options} />);

    const select = screen.getByLabelText(/Country/);
    expect(select).not.toHaveAttribute("aria-invalid");
    expect(select).not.toHaveAttribute("aria-describedby");
  });

  it("marks the select required and renders a decorative asterisk", () => {
    render(<Dropdown label="Country" options={options} required />);

    expect(screen.getByLabelText(/Country/)).toBeRequired();
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden");
  });

  it("generates a unique id when none is given", () => {
    render(
      <>
        <Dropdown label="First" options={options} />
        <Dropdown label="Second" options={options} />
      </>,
    );

    const first = screen.getByLabelText("First");
    const second = screen.getByLabelText("Second");

    expect(first.id).toBeTruthy();
    expect(first.id).not.toBe(second.id);
  });

  it("uses a provided id instead of the generated one", () => {
    render(<Dropdown label="Country" options={options} id="country" />);

    expect(screen.getByLabelText(/Country/)).toHaveAttribute("id", "country");
  });

  it.each(["sm", "md", "lg"] as const)("applies the %s size class", (size) => {
    const { container } = render(
      <Dropdown label="Country" options={options} size={size} />,
    );

    // CSS Module names are scoped, so match the readable stem.
    expect(container.firstElementChild?.className).toMatch(
      new RegExp(`${size}`),
    );
  });

  it("puts className on the select and containerClassName on the wrapper", () => {
    const { container } = render(
      <Dropdown
        label="Country"
        options={options}
        className="select-custom"
        containerClassName="wrapper-custom"
      />,
    );

    expect(screen.getByLabelText(/Country/)).toHaveClass("select-custom");
    expect(container.firstElementChild).toHaveClass("wrapper-custom");
    expect(container.firstElementChild).not.toHaveClass("select-custom");
  });

  it("forwards ref to the underlying select", () => {
    const ref = createRef<HTMLSelectElement>();
    render(<Dropdown label="Country" options={options} ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLSelectElement);
  });

  it("passes arbitrary select props through", () => {
    render(<Dropdown label="Country" options={options} name="country" />);

    expect(screen.getByLabelText(/Country/)).toHaveAttribute("name", "country");
  });

  it("renders without a label", () => {
    render(<Dropdown options={options} aria-label="Country" />);

    expect(screen.getByLabelText("Country")).toBeInTheDocument();
  });
});

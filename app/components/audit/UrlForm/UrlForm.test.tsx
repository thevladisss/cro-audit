import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UrlForm } from "./UrlForm";

describe("UrlForm", () => {
  it("renders the heading, instructions, input, and submit button", () => {
    render(<UrlForm onSubmit={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "CRO Audit" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Paste the URL of a page/)).toBeInTheDocument();
    expect(screen.getByLabelText("Page URL")).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByRole("button", { name: "Audit" })).toBeInTheDocument();
  });

  it("submits the normalized URL", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<UrlForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Page URL"), "example.com");
    await user.click(screen.getByRole("button", { name: "Audit" }));

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("https://example.com/");
  });

  it("submits on Enter", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<UrlForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Page URL"), "example.com{Enter}");

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("https://example.com/");
  });

  it("shows an error and does not submit when the field is empty", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<UrlForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Audit" }));

    expect(screen.getByText("Enter a URL to audit.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not validate while typing", async () => {
    const user = userEvent.setup();
    render(<UrlForm onSubmit={vi.fn()} />);

    await user.type(screen.getByLabelText("Page URL"), "ftp:/");

    expect(screen.queryByText(/Only http and https/)).not.toBeInTheDocument();
  });

  it("clears the error on the next change", async () => {
    const user = userEvent.setup();
    render(<UrlForm onSubmit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Audit" }));
    expect(screen.getByText("Enter a URL to audit.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Page URL"), "e");

    expect(screen.queryByText("Enter a URL to audit.")).not.toBeInTheDocument();
  });

  it("starts from defaultValue", () => {
    render(<UrlForm onSubmit={vi.fn()} defaultValue="https://example.com/" />);

    expect(screen.getByLabelText("Page URL")).toHaveValue(
      "https://example.com/",
    );
  });

  it("disables the field and the button when disabled", () => {
    render(<UrlForm onSubmit={vi.fn()} disabled />);

    expect(screen.getByLabelText("Page URL")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Audit" })).toBeDisabled();
  });
});

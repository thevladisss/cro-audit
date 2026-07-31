import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card";

describe("Card", () => {
  it("renders a div by default", () => {
    const { container } = render(<Card>Content</Card>);

    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(screen.getByText("Content")).toBeInTheDocument();
  });

  it("renders as another element via the as prop", () => {
    const { container } = render(<Card as="article">Content</Card>);

    expect(container.firstElementChild?.tagName).toBe("ARTICLE");
  });

  it("renders as a link and keeps the anchor props", () => {
    render(
      <Card as="a" href="/pricing" interactive>
        Pricing
      </Card>,
    );

    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  it("keeps the consumer className alongside its own", () => {
    const { container } = render(<Card className="custom">Content</Card>);

    const card = container.firstElementChild;
    expect(card).toHaveClass("custom");
    expect(card?.className.split(" ").length).toBeGreaterThan(1);
  });

  it("applies distinct variant and padding classes", () => {
    const { container } = render(
      <Card variant="elevated" padding="lg">
        Content
      </Card>,
    );

    // CSS Module names are scoped at build time, so match the readable stem
    // rather than the full hashed class.
    const className = container.firstElementChild?.className ?? "";
    expect(className).toMatch(/elevated/);
    expect(className).toMatch(/paddingLg/);
  });

  it("passes arbitrary props to the rendered element", () => {
    render(<Card data-testid="card">Content</Card>);

    expect(screen.getByTestId("card")).toBeInTheDocument();
  });
});

describe("Card sub-components", () => {
  it("renders a full composition", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
          <CardDescription>Billed monthly</CardDescription>
        </CardHeader>
        <CardBody>Body copy</CardBody>
        <CardFooter>Footer copy</CardFooter>
      </Card>,
    );

    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
    expect(screen.getByText("Billed monthly")).toBeInTheDocument();
    expect(screen.getByText("Body copy")).toBeInTheDocument();
    expect(screen.getByText("Footer copy")).toBeInTheDocument();
  });

  it("renders CardTitle as an h3 by default", () => {
    render(<CardTitle>Plan</CardTitle>);

    expect(screen.getByRole("heading", { level: 3, name: "Plan" })).toBeInTheDocument();
  });

  it("renders CardTitle at the requested heading level", () => {
    render(<CardTitle as="h2">Plan</CardTitle>);

    expect(screen.getByRole("heading", { level: 2, name: "Plan" })).toBeInTheDocument();
  });

  it("merges className on each sub-component", () => {
    const { container } = render(
      <CardHeader className="header-custom">Header</CardHeader>,
    );

    expect(container.firstElementChild).toHaveClass("header-custom");
  });
});

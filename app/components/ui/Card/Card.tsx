import type { ComponentPropsWithRef, ElementType, ReactNode } from "react";

import styles from "./Card.module.css";

export type CardVariant = "outlined" | "elevated" | "filled";
export type CardPadding = "none" | "sm" | "md" | "lg";

const paddingClass: Record<CardPadding, string> = {
  none: styles.paddingNone,
  sm: styles.paddingSm,
  md: styles.paddingMd,
  lg: styles.paddingLg,
};

export type CardProps<T extends ElementType = "div"> = {
  /** Render as another element, e.g. `as="a"` or `as="article"`. */
  as?: T;
  variant?: CardVariant;
  padding?: CardPadding;
  /** Adds hover/focus affordances. Pair with `as="a"` or `as="button"`. */
  interactive?: boolean;
  children?: ReactNode;
} & Omit<ComponentPropsWithRef<T>, "as" | "children">;

export function Card<T extends ElementType = "div">({
  as,
  variant = "outlined",
  padding = "md",
  interactive = false,
  className,
  children,
  ...props
}: CardProps<T>) {
  const Component = (as ?? "div") as ElementType;

  return (
    <Component
      className={[
        styles.card,
        styles[variant],
        paddingClass[padding],
        interactive && styles.interactive,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </Component>
  );
}

export function CardHeader({
  className,
  ...props
}: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={[styles.header, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export type CardTitleProps = ComponentPropsWithRef<"h3"> & {
  /** Heading level to render. Pick the one that fits the page outline. */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
};

export function CardTitle({ as = "h3", className, ...props }: CardTitleProps) {
  const Component = as;

  return (
    <Component
      className={[styles.title, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: ComponentPropsWithRef<"p">) {
  return (
    <p
      className={[styles.description, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={[styles.body, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function CardFooter({
  className,
  ...props
}: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={[styles.footer, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export default Card;

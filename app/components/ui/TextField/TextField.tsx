"use client";

import { useId, type ComponentPropsWithRef } from "react";

import styles from "./TextField.module.css";

export type TextFieldProps = Omit<ComponentPropsWithRef<"input">, "size"> & {
  label?: string;
  hint?: string;
  /** When set, the field renders in its invalid state and this replaces the hint. */
  error?: string;
  fullWidth?: boolean;
  /** Applied to the wrapper, not the <input>. */
  containerClassName?: string;
};

export function TextField({
  label,
  hint,
  error,
  fullWidth = false,
  required,
  disabled,
  id,
  className,
  containerClassName,
  type = "text",
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div
      className={[
        styles.root,
        fullWidth && styles.fullWidth,
        error && styles.invalid,
        containerClassName,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label && (
        <label className={styles.label} htmlFor={inputId}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden>
              *
            </span>
          )}
        </label>
      )}

      <input
        id={inputId}
        type={type}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={[styles.input, className].filter(Boolean).join(" ")}
        {...props}
      />

      {message && (
        <p
          id={messageId}
          className={[styles.message, error && styles.errorMessage]
            .filter(Boolean)
            .join(" ")}
        >
          {message}
        </p>
      )}
    </div>
  );
}

export default TextField;

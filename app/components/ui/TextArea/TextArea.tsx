"use client";

import { useId, type ComponentPropsWithRef } from "react";

import styles from "./TextArea.module.css";

export type TextAreaProps = ComponentPropsWithRef<"textarea"> & {
  label?: string;
  hint?: string;
  /** When set, the field renders in its invalid state and this replaces the hint. */
  error?: string;
  fullWidth?: boolean;
  /** Grows with its content instead of scrolling. */
  autoResize?: boolean;
  /** Shows a `used / maxLength` counter. Requires `maxLength` and a controlled `value`. */
  showCount?: boolean;
  /** Applied to the wrapper, not the <textarea>. */
  containerClassName?: string;
};

export function TextArea({
  label,
  hint,
  error,
  fullWidth = false,
  autoResize = false,
  showCount = false,
  required,
  disabled,
  id,
  value,
  defaultValue,
  maxLength,
  className,
  containerClassName,
  rows = 4,
  ...props
}: TextAreaProps) {
  const generatedId = useId();
  const textAreaId = id ?? generatedId;
  const messageId = `${textAreaId}-message`;
  const message = error ?? hint;

  const counted = showCount && maxLength !== undefined;
  const length = String(value ?? defaultValue ?? "").length;

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
        <label className={styles.label} htmlFor={textAreaId}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden>
              *
            </span>
          )}
        </label>
      )}

      <textarea
        id={textAreaId}
        rows={rows}
        required={required}
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={[styles.textarea, autoResize && styles.autoResize, className]
          .filter(Boolean)
          .join(" ")}
        {...props}
      />

      {(message || counted) && (
        <div className={styles.footer}>
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
          {counted && (
            <span
              className={[styles.counter, length > maxLength && styles.counterOver]
                .filter(Boolean)
                .join(" ")}
            >
              {length}/{maxLength}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default TextArea;

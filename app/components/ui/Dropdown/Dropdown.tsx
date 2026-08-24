"use client";

import { useId, type ComponentPropsWithRef, type ReactNode } from "react";

import styles from "./Dropdown.module.css";

export type DropdownSize = "sm" | "md" | "lg";

export type DropdownOption = {
  label: string;
  value: string | number;
  disabled?: boolean;
};

export type DropdownProps = Omit<ComponentPropsWithRef<"select">, "size"> & {
  label?: string;
  hint?: string;
  /** When set, the field renders in its invalid state and this replaces the hint. */
  error?: string;
  size?: DropdownSize;
  /** Rendered as a disabled leading option, selected until the user picks one. */
  placeholder?: string;
  options?: DropdownOption[];
  /** Use instead of `options` when you need `<optgroup>` or custom `<option>` markup. */
  children?: ReactNode;
  /** Applied to the wrapper, not the <select>. */
  containerClassName?: string;
};

export function Dropdown({
  label,
  hint,
  error,
  size = "md",
  placeholder,
  options,
  required,
  disabled,
  id,
  value,
  defaultValue,
  className,
  containerClassName,
  children,
  ...props
}: DropdownProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const messageId = `${selectId}-message`;
  const message = error ?? hint;

  // Let the placeholder be the resting selection when nothing else is chosen.
  const resolvedDefaultValue =
    value === undefined && defaultValue === undefined && placeholder !== undefined
      ? ""
      : defaultValue;

  return (
    <div
      className={[
        styles.root,
        styles[size],
        error && styles.invalid,
        containerClassName,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label && (
        <label className={styles.label} htmlFor={selectId}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden>
              *
            </span>
          )}
        </label>
      )}

      <div className={styles.control}>
        <select
          id={selectId}
          required={required}
          disabled={disabled}
          value={value}
          defaultValue={resolvedDefaultValue}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={[styles.select, className].filter(Boolean).join(" ")}
          {...props}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options?.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
          {children}
        </select>
        <span className={styles.chevron} aria-hidden />
      </div>

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

export default Dropdown;

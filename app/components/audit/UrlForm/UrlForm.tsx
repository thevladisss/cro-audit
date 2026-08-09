"use client";

import { useState, type FormEvent } from "react";

import { Button, TextField } from "@/app/components/ui";
import { normalizeUrl } from "@/app/utils";

import styles from "./UrlForm.module.css";

export type UrlFormProps = {
  /** Receives the normalized URL — always absolute, always http(s). */
  onSubmit: (url: string) => void;
  /** The value to start with, so returning from a scan doesn't clear the field. */
  defaultValue?: string;
  disabled?: boolean;
};

export function UrlForm({
  onSubmit,
  defaultValue = "",
  disabled = false,
}: UrlFormProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);

  // Validate on submit, not on keystroke — checking as someone types a URL
  // flashes an error at every intermediate character.
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const result = normalizeUrl(value);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    setError(null);
    onSubmit(result.url);
  }

  return (
    <section className={styles.root}>
      <div className={styles.content}>
        <h1 className={styles.title}>CRO Audit</h1>

        <p className={styles.lede}>
          Paste the URL of a page you want audited. We render it in a real
          browser, run 30 conversion heuristics, and give you a scored report.
        </p>

        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <TextField
            type="url"
            name="url"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            fullWidth
            placeholder="https://example.com"
            aria-label="Page URL"
            value={value}
            error={error ?? undefined}
            disabled={disabled}
            containerClassName={styles.field}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
          />

          <Button type="submit" size="lg" disabled={disabled}>
            Audit
          </Button>
        </form>

        <p className={styles.hint}>
          Works on any public page — no logins or paywalls. Takes about a minute.
        </p>
      </div>
    </section>
  );
}

export default UrlForm;

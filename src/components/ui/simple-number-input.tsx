import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";

interface SimpleNumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

export function SimpleNumberInput({
  value,
  onChange,
  min = 0,
  max = 65535,
  className,
}: SimpleNumberInputProps) {
  const { t } = useTranslation();
  const [text, setText] = React.useState(String(value));
  const [error, setError] = React.useState<string | null>(null);
  const focusedRef = React.useRef(false);

  React.useEffect(() => {
    if (!focusedRef.current) {
      setText(String(value));
      setError(null);
    }
  }, [value]);

  const validate = (raw: string): { ok: true; num: number } | { ok: false; message: string } => {
    if (raw.trim() === "") {
      return { ok: false, message: t("portInvalid") };
    }
    if (!/^\d+$/.test(raw.trim())) {
      return { ok: false, message: t("portInvalid") };
    }
    const num = Number(raw.trim());
    if (!Number.isFinite(num)) {
      return { ok: false, message: t("portInvalid") };
    }
    if (num < min || num > max) {
      return { ok: false, message: t("portOutOfRange", { min, max }) };
    }
    return { ok: true, num };
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setText(raw);

    const result = validate(raw);
    if (!result.ok) {
      setError(result.message);
      return; // keep previous saved value
    }

    setError(null);
    if (result.num !== value) {
      onChange(result.num);
    }
  };

  const handleBlur = () => {
    focusedRef.current = false;
    const result = validate(text);
    if (!result.ok) {
      // revert display to last saved value; do not persist invalid input
      setText(String(value));
      setError(null);
    }
  };

  return (
    <div className={cn("flex flex-col items-end gap-1 shrink-0", className)}>
      <div
        className={cn(
          "flex items-center border bg-input/30 rounded-lg overflow-hidden h-8 select-none w-full",
          error
            ? "border-red-500/60"
            : "border-zinc-500/20 dark:border-zinc-500/20"
        )}
      >
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={handleChange}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onBlur={handleBlur}
          className="w-full text-center text-xs font-semibold bg-transparent h-full focus:outline-none text-zinc-900 dark:text-zinc-100 px-2"
        />
      </div>
      {error && (
        <p className="text-[10px] leading-tight text-red-500 max-w-[11rem] text-end">
          {error}
        </p>
      )}
    </div>
  );
}

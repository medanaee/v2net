import * as React from "react";
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
  className
}: SimpleNumberInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    // Allow empty string to let user delete the number before typing a new one
    if (rawVal === '') {
      onChange(0);
      return;
    }
    const val = Number(rawVal);
    if (!isNaN(val)) {
      const clampedVal = Math.max(min, Math.min(max, val));
      onChange(clampedVal);
    }
  };

  return (
    <div className={cn("flex items-center border border-zinc-500/20 dark:border-zinc-500/20 bg-zinc-500/20 rounded-lg overflow-hidden h-8 select-none shrink-0", className)}>
      <input
        type="text"
        value={value || ''}
        onChange={handleChange}
        className="w-full text-center text-xs font-semibold bg-transparent h-full focus:outline-none text-zinc-900 dark:text-zinc-100"
      />
    </div>
  );
}

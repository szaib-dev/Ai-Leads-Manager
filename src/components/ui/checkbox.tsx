import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import styles from "./checkbox.module.css";
export function Checkbox({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type">) {
  return (
    <input
      {...props}
      type="checkbox"
      className={cn(styles.checkbox, className)}
    />
  );
}

"use client";
import * as React from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./select.module.css";
type OptionProps = {
  value?: string | number;
  disabled?: boolean;
  children?: React.ReactNode;
};
function text(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<OptionProps>(node)) return text(node.props.children);
  return "";
}
const EMPTY = "__folio_empty_option";
interface Props extends Pick<
  Primitive.SelectProps,
  "name" | "disabled" | "required" | "form" | "onOpenChange"
> {
  children: React.ReactNode;
  value?: string | number;
  defaultValue?: string | number;
  onValueChange?: (value: string) => void;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  className?: string;
  style?: React.CSSProperties;
  variant?: "default" | "plain";
}
export function Select({
  children,
  value,
  defaultValue,
  onValueChange,
  id,
  className,
  style,
  variant = "default",
  ...props
}: Props) {
  const options = React.Children.toArray(children).filter(
    (c): c is React.ReactElement<OptionProps> =>
      React.isValidElement<OptionProps>(c),
  );
  const encode = (v: string | number) => (String(v) === "" ? EMPTY : String(v));
  const first = options[0];
  const initial =
    defaultValue ??
    (first ? (first.props.value ?? text(first.props.children)) : "");
  return (
    <Primitive.Root
      name={props.name}
      form={props.form}
      disabled={props.disabled}
      required={props.required}
      value={value === undefined ? undefined : encode(value)}
      defaultValue={encode(initial)}
      onValueChange={(v) => onValueChange?.(v === EMPTY ? "" : v)}
      onOpenChange={props.onOpenChange}
    >
      <Primitive.Trigger
        id={id}
        aria-label={props["aria-label"]}
        aria-describedby={props["aria-describedby"]}
        data-slot="select-trigger"
        className={cn(
          styles.trigger,
          variant === "plain" && styles.plain,
          className,
        )}
        style={style}
      >
        <Primitive.Value />
        <Primitive.Icon className={styles.icon}>
          <ChevronDown size={14} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          position="popper"
          align="start"
          sideOffset={5}
          collisionPadding={12}
          className={styles.content}
        >
          <Primitive.ScrollUpButton className={styles.scroll}>
            <ChevronUp size={14} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className={styles.viewport}>
            {options.map((o, i) => {
              const label = text(o.props.children),
                v = encode(o.props.value ?? label);
              return (
                <Primitive.Item
                  key={`${v}:${i}`}
                  value={v}
                  disabled={o.props.disabled}
                  className={styles.item}
                >
                  <Primitive.ItemText>{label}</Primitive.ItemText>
                  <Primitive.ItemIndicator className={styles.check}>
                    <Check size={14} />
                  </Primitive.ItemIndicator>
                </Primitive.Item>
              );
            })}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className={styles.scroll}>
            <ChevronDown size={14} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

"use client";
import * as React from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export function DropdownMenuContent({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        className="dropdown-content"
        sideOffset={6}
        collisionPadding={12}
        align="end"
        {...props}
      >
        {children}
      </Menu.Content>
    </Menu.Portal>
  );
}
export function DropdownMenuItem(
  props: React.ComponentPropsWithoutRef<typeof Menu.Item>,
) {
  return <Menu.Item className="dropdown-item" {...props} />;
}

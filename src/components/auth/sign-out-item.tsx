"use client";
import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/auth/actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/providers";
export function SignOutItem() {
  const [pending, startTransition] = useTransition();
  const { toast } = useWorkspace();
  return (
    <DropdownMenuItem
      disabled={pending}
      onSelect={() =>
        startTransition(async () => {
          try {
            await logout();
          } catch {
            toast("Sign out could not complete. Please try again.");
          }
        })
      }
    >
      <LogOut size={16} />
      {pending ? "Signing out…" : "Sign out"}
    </DropdownMenuItem>
  );
}

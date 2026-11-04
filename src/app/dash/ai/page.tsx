import type { Viewport } from "next";
import { AiWorkspace } from "@/components/ai/workspace";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; chat?: string }>;
}) {
  const params = await searchParams;
  return <AiWorkspace initialPage={params.page} conversationId={params.chat} />;
}

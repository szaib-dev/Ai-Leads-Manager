import { QueryClient } from "@tanstack/react-query";
export function createWorkspaceQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 120_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  });
}
export function workspaceQueryKey(
  ownerId: string,
  epoch: number,
  scope: string,
  ...parts: unknown[]
) {
  return [ownerId, epoch, scope, ...parts] as const;
}

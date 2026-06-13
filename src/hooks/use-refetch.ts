import { useQueryClient } from "@tanstack/react-query";

export default function useRefetch() {
  const queryClient = useQueryClient();

  return async (queryKeys?: string[]) => {
    if (queryKeys && queryKeys.length > 0) {
      // Refetch specific queries
      for (const key of queryKeys) {
        await queryClient.refetchQueries({
          queryKey: [key],
        });
      }
    } else {
      // Refetch all active queries (original behavior)
      await queryClient.refetchQueries({
        type: "active",
      });
    }
  };
}

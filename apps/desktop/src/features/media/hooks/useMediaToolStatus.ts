import { useQuery } from "@tanstack/react-query";

import { getMediaToolStatus } from "../api";
import { mediaToolStatusKey } from "@dawnsight/query-keys";

/** ffprobe presence for settings/degrade UI. No media file needed. */
export function useMediaToolStatus(enabled = true) {
  return useQuery({
    queryKey: mediaToolStatusKey(),
    queryFn: getMediaToolStatus,
    enabled,
    retry: false,
    staleTime: Infinity,
  });
}

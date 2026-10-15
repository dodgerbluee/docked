/**
 * Custom hook for fetching unused images via GraphQL
 */

import { useState, useCallback } from "react";
import { graphqlClient } from "../graphql/client";
import { UNUSED_IMAGES_QUERY } from "../graphql/queries";

/** Maps GraphQL DockerImage to the shape the UnusedTab UI expects. */
function mapUnusedImage(img) {
  const firstTag = img.repoTags?.[0] || "";
  return {
    ...img,
    size: img.sizeBytes,
    repo: firstTag.split(":")[0],
    sourceName: img.sourceUrl || null,
  };
}

export function useUnusedImages() {
  const [unusedImages, setUnusedImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchUnusedImages = useCallback(async () => {
    try {
      setLoading(true);
      const result = await graphqlClient.query(UNUSED_IMAGES_QUERY).toPromise();
      if (result.error) throw new Error(result.error.message);
      setUnusedImages((result.data?.unusedImages || []).map(mapUnusedImage));
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to fetch unused images");
      console.error("Error fetching unused images:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    unusedImages,
    loading,
    error,
    refetch: fetchUnusedImages,
  };
}

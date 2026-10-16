/**
 * Graph wrappers for image operations, returning the REST-compatible
 * response shape the container-page hooks already consume
 * ({ success, deleted, results, errors }).
 */

import { graphqlClient } from "./client";
import { DELETE_IMAGES_MUTATION } from "./queries";

/**
 * @param {Array<{id: string, portainerUrl?: string, sourceUrl?: string, endpointId?: number, runnerId?: number|string}>} images
 * @returns {Promise<{success: boolean, deleted: number, results: Array, errors?: Array}>}
 */
export async function deleteImages(images) {
  // The graph input types runnerId as String; UI rows carry numeric ids.
  const payload = images.map((img) =>
    img.runnerId != null ? { ...img, runnerId: String(img.runnerId) } : img
  );
  const result = await graphqlClient
    .mutation(DELETE_IMAGES_MUTATION, { images: payload })
    .toPromise();
  if (result.error) {
    throw new Error(result.error.message);
  }
  const data = result.data?.deleteImages;
  if (!data) {
    throw new Error("image delete failed");
  }
  return data;
}

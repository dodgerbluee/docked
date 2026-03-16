/**
 * Unique key for an unused image across source instances.
 * Docker image IDs can repeat across instances; this key ensures
 * selection and deletion target the correct instance's image.
 * @param {Object} image - Image object with id and sourceUrl
 * @returns {string} Composite key
 */
export function getImageKey(image) {
  const url = image.portainerUrl ?? "";
  return `${url}|${image.id}`;
}

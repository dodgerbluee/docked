/**
 * Minimal graphql-multipart-request-spec uploader.
 * urql's fetchExchange cannot send multipart/form-data, so file uploads
 * (avatar) go through this helper; it matches the Go backend's
 * transport.MultipartForm handler.
 */

/**
 * @param {string} query - GraphQL document with an `Upload!` variable
 * @param {Object} variables - variables; upload slots are replaced by file entries
 * @param {Object<string, File|Blob>} files - map of variable name -> File
 * @returns {Promise<Object>} - the `data` payload
 * @throws {Error} - first GraphQL error message
 */
export async function uploadGraphQL(query, variables, files) {
  const map = {};
  const vars = { ...variables };
  const parts = [];
  Object.entries(files).forEach(([varName, file], i) => {
    vars[varName] = null;
    map[String(i)] = [`variables.${varName}`];
    parts.push([String(i), file]);
  });

  const formData = new FormData();
  formData.append("operations", JSON.stringify({ query, variables: vars }));
  formData.append("map", JSON.stringify(map));
  for (const [name, file] of parts) {
    formData.append(name, file, file.name || "upload");
  }

  const token = localStorage.getItem("authToken");
  const response = await fetch("/graphql", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok && !json) {
    throw new Error(`Upload failed (${response.status})`);
  }
  if (json?.errors?.length) {
    throw new Error(json.errors[0].message);
  }
  return json?.data ?? {};
}

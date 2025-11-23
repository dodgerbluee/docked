/**
 * Portainer Instance Repository
 * Handles all Portainer instance database operations
 */

const BaseRepository = require("./BaseRepository");
const { NotFoundError } = require("../utils/errors");

class PortainerInstanceRepository extends BaseRepository {
  /**
   * Find all Portainer instances
   * @returns {Promise<Array>} - Array of Portainer instances
   */
  async findAll() {
    // Note: Migrations should ensure all columns exist on startup
    // If you see "no such column" errors, check that migrations ran successfully
    return await super.findAll(
      "SELECT id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at FROM portainer_instances ORDER BY display_order ASC, created_at ASC",
      [],
      { cache: true, cacheKey: "portainer_instances:all" }
    );
  }

  /**
   * Find Portainer instance by ID
   * @param {number} id - Instance ID
   * @returns {Promise<Object|null>} - Portainer instance or null
   */
  async findById(id) {
    return await this.findOne(
      "SELECT id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at FROM portainer_instances WHERE id = ?",
      [id]
    );
  }

  /**
   * Find Portainer instance by URL
   * @param {string} url - Portainer URL
   * @returns {Promise<Object|null>} - Portainer instance or null
   */
  async findByUrl(url) {
    return await this.findOne(
      "SELECT id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at FROM portainer_instances WHERE url = ?",
      [url]
    );
  }

  /**
   * Create a new Portainer instance
   * @param {Object} data - Instance data
   * @returns {Promise<number>} - Instance ID
   */
  async create(data) {
    const { name, url, username, password, apiKey, authType, ipAddress } = data;

    // Get max display_order
    const maxOrder = await this.findOne(
      "SELECT MAX(display_order) as max_order FROM portainer_instances"
    );
    const nextOrder = (maxOrder?.max_order ?? -1) + 1;

    // Use appropriate fields based on auth type
    const finalUsername = authType === "apikey" ? "" : username || "";
    const finalPassword = authType === "apikey" ? "" : password || "";
    const finalApiKey = authType === "apikey" ? apiKey || null : null;

    const result = await this.execute(
      "INSERT INTO portainer_instances (name, url, username, password, api_key, auth_type, display_order, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [name, url, finalUsername, finalPassword, finalApiKey, authType, nextOrder, ipAddress]
    );

    // Invalidate cache after create
    BaseRepository.invalidateCache("portainer_instances:");

    return result.lastID;
  }

  /**
   * Update a Portainer instance
   * @param {number} id - Instance ID
   * @param {Object} data - Update data
   * @returns {Promise<void>}
   */
  async update(id, data) {
    const { name, url, username, password, apiKey, authType, ipAddress } = data;

    // Use appropriate fields based on auth type
    const finalUsername = authType === "apikey" ? "" : username || "";
    const finalPassword = authType === "apikey" ? "" : password || "";
    const finalApiKey = authType === "apikey" ? apiKey || null : null;

    await this.execute(
      "UPDATE portainer_instances SET name = ?, url = ?, username = ?, password = ?, api_key = ?, auth_type = ?, ip_address = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [name, url, finalUsername, finalPassword, finalApiKey, authType, ipAddress, id]
    );

    // Invalidate cache after update
    BaseRepository.invalidateCache("portainer_instances:");
  }

  /**
   * Delete a Portainer instance
   * @param {number} id - Instance ID
   * @returns {Promise<void>}
   */
  async delete(id) {
    await this.execute("DELETE FROM portainer_instances WHERE id = ?", [id]);

    // Invalidate cache after delete
    BaseRepository.invalidateCache("portainer_instances:");
  }

  /**
   * Update display order of instances
   * @param {Array<{id: number, display_order: number}>} orders - Array of id and display_order pairs
   * @returns {Promise<void>}
   */
  async updateOrder(orders) {
    return await this.transaction(async () => {
      for (const { id, display_order } of orders) {
        await this.execute(
          "UPDATE portainer_instances SET display_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
          [display_order, id]
        );
      }

      // Invalidate cache after order update
      BaseRepository.invalidateCache("portainer_instances:");
    });
  }
}

module.exports = PortainerInstanceRepository;

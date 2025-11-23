/**
 * User Repository
 * Handles all user-related database operations
 */

const BaseRepository = require("./BaseRepository");
const bcrypt = require("bcrypt");

class UserRepository extends BaseRepository {
  /**
   * Find user by username
   * @param {string} username - Username
   * @returns {Promise<Object|null>} - User object or null
   */
  async findByUsername(username) {
    return await this.findOne("SELECT * FROM users WHERE username = ?", [username]);
  }

  /**
   * Find user by ID
   * @param {number} id - User ID
   * @returns {Promise<Object|null>} - User object or null (without password)
   */
  async findById(id) {
    return await this.findOne(
      "SELECT id, username, email, role, instance_admin, created_at, updated_at, last_login FROM users WHERE id = ?",
      [id]
    );
  }

  /**
   * Find user by ID with password (for authentication)
   * @param {number} id - User ID
   * @returns {Promise<Object|null>} - User object or null (with password_hash)
   */
  async findByIdWithPassword(id) {
    return await this.findOne("SELECT * FROM users WHERE id = ?", [id]);
  }

  /**
   * Find user by username with password (for authentication)
   * @param {string} username - Username
   * @returns {Promise<Object|null>} - User object or null (with password_hash)
   */
  async findByUsernameWithPassword(username) {
    return await this.findByUsername(username);
  }

  /**
   * Find all users
   * @returns {Promise<Array>} - Array of users (without passwords)
   */
  async findAll() {
    return await super.findAll(
      "SELECT id, username, email, role, instance_admin, created_at, updated_at, last_login FROM users ORDER BY created_at ASC",
      [],
      { cache: true, cacheKey: "users:all" }
    );
  }

  /**
   * Create a new user
   * @param {Object} userData - User data
   * @param {string} userData.username - Username
   * @param {string} userData.email - Email
   * @param {string} userData.passwordHash - Hashed password
   * @param {string} [userData.role="user"] - User role
   * @param {boolean} [userData.instanceAdmin=false] - Instance admin flag
   * @returns {Promise<number>} - User ID
   */
  async create(userData) {
    const { username, email, passwordHash, role = "user", instanceAdmin = false } = userData;

    const result = await this.execute(
      "INSERT INTO users (username, email, password_hash, role, instance_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
      [username, email, passwordHash, role, instanceAdmin ? 1 : 0]
    );

    // Invalidate cache
    BaseRepository.invalidateCache("users:");

    return result.lastID;
  }

  /**
   * Update user
   * @param {number} id - User ID
   * @param {Object} userData - Update data
   * @returns {Promise<void>}
   */
  async update(id, userData) {
    const { email, role, instanceAdmin } = userData;

    const updates = [];
    const params = [];

    if (email !== undefined) {
      updates.push("email = ?");
      params.push(email);
    }
    if (role !== undefined) {
      updates.push("role = ?");
      params.push(role);
    }
    if (instanceAdmin !== undefined) {
      updates.push("instance_admin = ?");
      params.push(instanceAdmin ? 1 : 0);
    }

    if (updates.length === 0) {
      return; // No updates
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id);

    await this.execute(
      `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
      params
    );

    // Invalidate cache
    BaseRepository.invalidateCache("users:");
  }

  /**
   * Update user password
   * @param {number} id - User ID
   * @param {string} passwordHash - Hashed password
   * @returns {Promise<void>}
   */
  async updatePassword(id, passwordHash) {
    await this.execute(
      "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [passwordHash, id]
    );

    // Invalidate cache
    BaseRepository.invalidateCache("users:");
  }

  /**
   * Update user password by username
   * @param {string} username - Username
   * @param {string} passwordHash - Hashed password
   * @returns {Promise<void>}
   */
  async updatePasswordByUsername(username, passwordHash) {
    await this.execute(
      "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
      [passwordHash, username]
    );

    // Invalidate cache
    BaseRepository.invalidateCache("users:");
  }

  /**
   * Update last login timestamp
   * @param {number} id - User ID
   * @returns {Promise<void>}
   */
  async updateLastLogin(id) {
    await this.execute(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    );
  }

  /**
   * Delete user
   * @param {number} id - User ID
   * @returns {Promise<void>}
   */
  async delete(id) {
    await this.execute("DELETE FROM users WHERE id = ?", [id]);

    // Invalidate cache
    BaseRepository.invalidateCache("users:");
  }

  /**
   * Verify password
   * @param {string} plainPassword - Plain text password
   * @param {string} hashedPassword - Hashed password from database
   * @returns {Promise<boolean>} - True if password matches
   */
  async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  /**
   * Hash password
   * @param {string} plainPassword - Plain text password
   * @returns {Promise<string>} - Hashed password
   */
  async hashPassword(plainPassword) {
    return await bcrypt.hash(plainPassword, 10);
  }

  /**
   * Get user statistics
   * @param {number} userId - User ID
   * @returns {Promise<Object>} - User statistics
   */
  async getStats(userId) {
    return await this.findOne(
      `SELECT 
        (SELECT COUNT(*) FROM portainer_instances WHERE user_id = ?) as portainer_instances_count,
        (SELECT COUNT(*) FROM containers WHERE user_id = ?) as containers_count,
        (SELECT COUNT(*) FROM tracked_apps WHERE user_id = ?) as tracked_apps_count,
        (SELECT COUNT(*) FROM discord_webhooks WHERE user_id = ?) as discord_webhooks_count`,
      [userId, userId, userId, userId]
    );
  }
}

module.exports = UserRepository;


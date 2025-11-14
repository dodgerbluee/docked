/**
 * User Repository
 * Handles all user-related database operations
 */

const BaseRepository = require('./BaseRepository');
const { NotFoundError, DatabaseError } = require('../domain/errors');
const bcrypt = require('bcrypt');

class UserRepository extends BaseRepository {
  /**
   * Find user by username
   * @param {string} username - Username
   * @returns {Promise<Object|null>} - User object or null
   */
  async findByUsername(username) {
    const user = await this.findOne(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    return user;
  }

  /**
   * Find user by ID
   * @param {number} id - User ID
   * @returns {Promise<Object|null>} - User object or null
   */
  async findById(id) {
    const user = await this.findOne(
      'SELECT id, username, role, password_hash, password_changed, created_at, updated_at FROM users WHERE id = ?',
      [id]
    );
    return user;
  }

  /**
   * Create a new user
   * @param {string} username - Username
   * @param {string} password - Plain text password
   * @param {string} role - User role (default: 'Administrator')
   * @returns {Promise<number>} - User ID
   */
  async create(username, password, role = 'Administrator') {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await this.execute(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, passwordHash, role]
    );
    return result.lastID;
  }

  /**
   * Update user password
   * @param {string} username - Username
   * @param {string} newPassword - New plain text password
   * @param {boolean} markPasswordChanged - Mark password as changed
   * @returns {Promise<void>}
   */
  async updatePassword(username, newPassword, markPasswordChanged = true) {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.execute(
      'UPDATE users SET password_hash = ?, password_changed = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
      [passwordHash, markPasswordChanged ? 1 : 0, username]
    );
  }

  /**
   * Update username
   * @param {string} oldUsername - Current username
   * @param {string} newUsername - New username
   * @returns {Promise<void>}
   */
  async updateUsername(oldUsername, newUsername) {
    await this.execute(
      'UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
      [newUsername, oldUsername]
    );
  }

  /**
   * Verify password
   * @param {string} plainPassword - Plain text password
   * @param {string} hashedPassword - Hashed password
   * @returns {Promise<boolean>} - True if password matches
   */
  async verifyPassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }

  /**
   * Check if user exists
   * @param {string} username - Username
   * @returns {Promise<boolean>} - True if user exists
   */
  async exists(username) {
    const user = await this.findByUsername(username);
    return user !== null;
  }

  /**
   * Get user count
   * @returns {Promise<number>} - Number of users
   */
  async count() {
    const result = await this.findOne('SELECT COUNT(*) as count FROM users');
    return result ? result.count : 0;
  }
}

module.exports = UserRepository;


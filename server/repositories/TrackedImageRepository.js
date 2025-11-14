/**
 * Tracked Image Repository
 * Handles all tracked image database operations
 */

const BaseRepository = require('./BaseRepository');

class TrackedImageRepository extends BaseRepository {
  /**
   * Find all tracked images
   * @returns {Promise<Array>} - Array of tracked images
   */
  async findAll() {
    return await super.findAll(
      'SELECT * FROM tracked_images ORDER BY name ASC',
      []
    );
  }

  /**
   * Find tracked image by ID
   * @param {number} id - Tracked image ID
   * @returns {Promise<Object|null>} - Tracked image or null
   */
  async findById(id) {
    return await this.findOne(
      'SELECT * FROM tracked_images WHERE id = ?',
      [id]
    );
  }

  /**
   * Find tracked image by image name or GitHub repo
   * @param {string} imageName - Image name (or null)
   * @param {string} githubRepo - GitHub repo (or null)
   * @returns {Promise<Object|null>} - Tracked image or null
   */
  async findByImageNameOrRepo(imageName = null, githubRepo = null) {
    if (githubRepo) {
      return await this.findOne(
        'SELECT * FROM tracked_images WHERE github_repo = ?',
        [githubRepo]
      );
    } else if (imageName) {
      return await this.findOne(
        'SELECT * FROM tracked_images WHERE image_name = ?',
        [imageName]
      );
    }
    return null;
  }

  /**
   * Create a new tracked image
   * @param {Object} data - Tracked image data
   * @returns {Promise<number>} - Tracked image ID
   */
  async create(data) {
    const { name, imageName, githubRepo, sourceType, gitlabToken } = data;
    const result = await this.execute(
      'INSERT INTO tracked_images (name, image_name, github_repo, source_type, gitlab_token) VALUES (?, ?, ?, ?, ?)',
      [name, imageName, githubRepo, sourceType || 'docker', gitlabToken]
    );
    return result.lastID;
  }

  /**
   * Update a tracked image
   * @param {number} id - Tracked image ID
   * @param {Object} data - Update data
   * @returns {Promise<void>}
   */
  async update(id, data) {
    const fields = [];
    const values = [];

    const allowedFields = [
      'name', 'image_name', 'current_version', 'current_digest',
      'latest_version', 'latest_digest', 'has_update', 'last_checked',
      'current_version_publish_date', 'latest_version_publish_date', 'gitlab_token'
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        if (field === 'has_update') {
          fields.push(`${field} = ?`);
          values.push(data[field] ? 1 : 0);
        } else {
          fields.push(`${field} = ?`);
          values.push(data[field]);
        }
      }
    }

    if (fields.length === 0) {
      return;
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const sql = `UPDATE tracked_images SET ${fields.join(', ')} WHERE id = ?`;
    await this.execute(sql, values);
  }

  /**
   * Delete a tracked image
   * @param {number} id - Tracked image ID
   * @returns {Promise<void>}
   */
  async delete(id) {
    await this.execute('DELETE FROM tracked_images WHERE id = ?', [id]);
  }

  /**
   * Clear latest version data for all tracked images
   * @returns {Promise<number>} - Number of rows updated
   */
  async clearLatestVersions() {
    const result = await this.execute(
      `UPDATE tracked_images 
       SET latest_version = NULL, 
           latest_digest = NULL, 
           has_update = 0,
           current_version_publish_date = NULL,
           updated_at = CURRENT_TIMESTAMP`
    );
    return result.changes;
  }
}

module.exports = TrackedImageRepository;


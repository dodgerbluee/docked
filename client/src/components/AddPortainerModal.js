/**
 * Add Portainer Instance Modal
 * Popup form to add a new Portainer instance
 */

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './AddPortainerModal.css';

// In production, API is served from same origin, so use relative URLs
const API_BASE_URL = process.env.REACT_APP_API_URL || 
  (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001');

function AddPortainerModal({ isOpen, onClose, onSuccess, initialData = null, instanceId = null }) {
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    username: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Update form data when initialData changes (for edit mode)
  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name || '',
        url: initialData.url || '',
        username: initialData.username || '',
        password: '', // Don't pre-fill password for security
      });
    } else {
      setFormData({ name: '', url: '', username: '', password: '' });
    }
  }, [initialData, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let response;
      if (instanceId) {
        // Update existing instance
        response = await axios.put(`${API_BASE_URL}/api/portainer/instances/${instanceId}`, formData);
      } else {
        // Create new instance
        response = await axios.post(`${API_BASE_URL}/api/portainer/instances`, formData);
      }
      
      if (response.data.success) {
        // Reset form
        setFormData({ name: '', url: '', username: '', password: '' });
        // Pass instance data to onSuccess callback for new instances
        const instanceData = instanceId 
          ? null // Don't pass data for edits
          : {
              name: formData.name || new URL(formData.url).hostname,
              url: formData.url,
              id: response.data.id,
            };
        onSuccess(instanceData);
        onClose();
      } else {
        setError(response.data.error || (instanceId ? 'Failed to update Portainer instance' : 'Failed to add Portainer instance'));
      }
    } catch (err) {
      setError(err.response?.data?.error || (instanceId ? 'Failed to update Portainer instance. Please try again.' : 'Failed to add Portainer instance. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{instanceId ? 'Edit Portainer Instance' : 'Add Portainer Instance'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-group">
            <label htmlFor="name">Instance Name (Optional)</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g., Production Portainer"
              disabled={loading}
            />
            <small>Defaults to URL hostname if empty</small>
          </div>

          <div className="form-group">
            <label htmlFor="url">Portainer URL *</label>
            <input
              type="url"
              id="url"
              name="url"
              value={formData.url}
              onChange={handleChange}
              required
              placeholder="http://portainer.example.com:9000"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="username">Username *</label>
            <input
              type="text"
              id="username"
              name="username"
              value={formData.username}
              onChange={handleChange}
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password {instanceId ? '' : '*'}</label>
            <input
              type="password"
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required={!instanceId}
              disabled={loading}
              placeholder={instanceId ? 'Leave blank to keep current password' : ''}
            />
            {instanceId && (
              <small>Leave blank to keep the current password</small>
            )}
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="modal-actions">
            <button
              type="button"
              className="modal-button cancel"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="modal-button submit"
              disabled={loading || !formData.url || !formData.username || (!instanceId && !formData.password)}
            >
              {loading ? (instanceId ? 'Updating...' : 'Adding...') : (instanceId ? 'Update Instance' : 'Add Instance')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddPortainerModal;


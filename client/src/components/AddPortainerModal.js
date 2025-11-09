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
  const [authType, setAuthType] = useState('apikey'); // 'password' or 'apikey'
  const [protocol, setProtocol] = useState('https'); // 'http' or 'https'
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    username: '',
    password: '',
    apiKey: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Clear error when modal opens or closes
  useEffect(() => {
    setError('');
  }, [isOpen]);

  // Update form data when initialData changes (for edit mode)
  useEffect(() => {
    if (initialData) {
      const initialAuthType = initialData.auth_type || 'apikey';
      setAuthType(initialAuthType);
      
      // Extract protocol from URL if it exists
      let urlWithoutProtocol = initialData.url || '';
      let initialProtocol = 'https';
      if (urlWithoutProtocol.startsWith('http://')) {
        initialProtocol = 'http';
        urlWithoutProtocol = urlWithoutProtocol.replace('http://', '');
      } else if (urlWithoutProtocol.startsWith('https://')) {
        initialProtocol = 'https';
        urlWithoutProtocol = urlWithoutProtocol.replace('https://', '');
      }
      setProtocol(initialProtocol);
      
      setFormData({
        name: initialData.name || '',
        url: urlWithoutProtocol,
        username: initialData.username || '',
        password: '', // Don't pre-fill password for security
        apiKey: '', // Don't pre-fill API key for security
      });
    } else {
      setAuthType('apikey');
      setProtocol('https');
      setFormData({ name: '', url: '', username: '', password: '', apiKey: '' });
    }
  }, [initialData, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Prepare request data based on auth type
      // Ensure URL has protocol prefix
      const urlWithProtocol = formData.url.startsWith('http://') || formData.url.startsWith('https://')
        ? formData.url
        : `${protocol}://${formData.url}`;
      
      const requestData = {
        name: formData.name,
        url: urlWithProtocol,
        authType: authType,
      };

      if (authType === 'apikey') {
        requestData.apiKey = formData.apiKey;
      } else {
        requestData.username = formData.username;
        requestData.password = formData.password;
      }

      let response;
      if (instanceId) {
        // Update existing instance (no validation needed)
        response = await axios.put(`${API_BASE_URL}/api/portainer/instances/${instanceId}`, requestData);
        
          if (response.data.success) {
            // Reset form
            setFormData({ name: '', url: '', username: '', password: '', apiKey: '' });
            setAuthType('apikey');
            // Pass the updated instance data so the parent can refresh
          onSuccess({
            id: instanceId,
            ...requestData,
          });
          onClose();
        } else {
          setError(response.data.error || 'Failed to update Portainer instance');
        }
      } else {
        // Create new instance - validate authentication first
        try {
          // Validate authentication before creating
          const validateData = {
            url: requestData.url,
            authType: requestData.authType,
          };
          
          if (authType === 'apikey') {
            validateData.apiKey = requestData.apiKey;
          } else {
            validateData.username = requestData.username;
            validateData.password = requestData.password;
          }

          const validateResponse = await axios.post(`${API_BASE_URL}/api/portainer/instances/validate`, validateData);
          
          if (!validateResponse.data.success) {
            setError(validateResponse.data.error || 'Authentication validation failed');
            setLoading(false);
            return;
          }

          // Authentication successful, now create the instance
          response = await axios.post(`${API_BASE_URL}/api/portainer/instances`, requestData);
          
          if (response.data.success) {
            // Reset form
            setFormData({ name: '', url: '', username: '', password: '', apiKey: '' });
            setAuthType('apikey');
            // Pass instance data to onSuccess callback for new instances
            const instanceData = {
              name: formData.name || new URL(formData.url).hostname,
              url: formData.url,
              id: response.data.id,
            };
            onSuccess(instanceData);
            onClose();
          } else {
            setError(response.data.error || 'Failed to add Portainer instance');
          }
        } catch (validateErr) {
          // Validation failed - show error
          setError(validateErr.response?.data?.error || 'Authentication failed. Please check your credentials and try again.');
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || (instanceId ? 'Failed to update Portainer instance. Please try again.' : 'Failed to add Portainer instance. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    let value = e.target.value;
    
    // If user types a protocol in the URL field, strip it and update protocol selector
    if (e.target.name === 'url') {
      if (value.startsWith('http://')) {
        value = value.replace('http://', '');
        setProtocol('http');
      } else if (value.startsWith('https://')) {
        value = value.replace('https://', '');
        setProtocol('https');
      }
    }
    
    setFormData({
      ...formData,
      [e.target.name]: value,
    });
  };

  // Handle protocol change - prepend protocol to URL
  const handleProtocolChange = (newProtocol) => {
    setProtocol(newProtocol);
    // If URL already has a protocol, remove it before adding the new one
    let urlWithoutProtocol = formData.url;
    if (urlWithoutProtocol.startsWith('http://')) {
      urlWithoutProtocol = urlWithoutProtocol.replace('http://', '');
    } else if (urlWithoutProtocol.startsWith('https://')) {
      urlWithoutProtocol = urlWithoutProtocol.replace('https://', '');
    }
    setFormData({
      ...formData,
      url: urlWithoutProtocol,
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <label htmlFor="url" style={{ margin: 0, flex: 1 }}>Portainer URL *</label>
              <div className="protocol-toggle">
                <button
                  type="button"
                  className={`protocol-option ${protocol === 'http' ? 'active' : ''}`}
                  onClick={() => !loading && handleProtocolChange('http')}
                  disabled={loading}
                  aria-pressed={protocol === 'http'}
                >
                  HTTP
                </button>
                <button
                  type="button"
                  className={`protocol-option ${protocol === 'https' ? 'active' : ''}`}
                  onClick={() => !loading && handleProtocolChange('https')}
                  disabled={loading}
                  aria-pressed={protocol === 'https'}
                >
                  HTTPS
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ 
                color: 'var(--text-secondary)', 
                fontSize: '0.9rem',
                whiteSpace: 'nowrap'
              }}>
                {protocol}://
              </span>
              <input
                type="text"
                id="url"
                name="url"
                value={formData.url}
                onChange={handleChange}
                required
                placeholder="portainer.example.com:9000"
                disabled={loading}
                style={{ flex: 1 }}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Authentication Method *</label>
            <div className="auth-type-toggle">
              <button
                type="button"
                className={`auth-type-option ${authType === 'apikey' ? 'active' : ''}`}
                onClick={() => !loading && setAuthType('apikey')}
                disabled={loading}
                aria-pressed={authType === 'apikey'}
              >
                <span className="auth-type-icon">🔑</span>
                <span>API Key</span>
              </button>
              <button
                type="button"
                className={`auth-type-option ${authType === 'password' ? 'active' : ''}`}
                onClick={() => !loading && setAuthType('password')}
                disabled={loading}
                aria-pressed={authType === 'password'}
              >
                <span className="auth-type-icon">🔐</span>
                <span>Username / Password</span>
              </button>
            </div>
          </div>

          {authType === 'password' ? (
            <>
              <div className="form-group">
                <label htmlFor="username">Username *</label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  required={authType === 'password'}
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
                  required={authType === 'password' && !instanceId}
                  disabled={loading}
                  placeholder={instanceId ? 'Leave blank to keep current password' : ''}
                />
                {instanceId && (
                  <small>Leave blank to keep the current password</small>
                )}
              </div>
            </>
          ) : (
            <div className="form-group">
              <label htmlFor="apiKey">API Key {instanceId ? '' : '*'}</label>
              <input
                type="password"
                id="apiKey"
                name="apiKey"
                value={formData.apiKey}
                onChange={handleChange}
                required={authType === 'apikey' && !instanceId}
                disabled={loading}
                placeholder={instanceId ? 'Leave blank to keep current API key' : 'Enter your Portainer API key'}
              />
              {instanceId && (
                <small>Leave blank to keep the current API key</small>
              )}
            </div>
          )}

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
              disabled={
                loading || 
                !formData.url || 
                (authType === 'password' && (!formData.username || (!instanceId && !formData.password))) ||
                (authType === 'apikey' && (!instanceId && !formData.apiKey))
              }
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


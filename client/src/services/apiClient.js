/**
 * Centralized API Client
 * Provides a single, consistent interface for all API calls
 * Handles authentication, error handling, request/response transformation
 */

import axios from 'axios';
import { API_BASE_URL } from '../constants/api';
import { ApiError, NetworkError, AuthenticationError, ValidationError, NotFoundError, RateLimitError, ServerError } from '../domain/errors';

/**
 * Create axios instance with default configuration
 */
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000, // 30 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Request interceptor - Add auth token to requests
 */
apiClient.interceptors.request.use(
  (config) => {
    // Get token from localStorage (avoiding direct dependency on useAuth)
    const token = localStorage.getItem('authToken');
    
    if (token && isValidToken(token)) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    // Add request ID for correlation
    config.metadata = {
      requestId: generateRequestId(),
      startTime: Date.now(),
    };
    
    return config;
  },
  (error) => {
    return Promise.reject(new NetworkError('Failed to send request', error));
  }
);

/**
 * Response interceptor - Handle errors and transform responses
 */
apiClient.interceptors.response.use(
  (response) => {
    // Log successful requests in development
    if (process.env.NODE_ENV === 'development' && response.config.metadata) {
      const duration = Date.now() - response.config.metadata.startTime;
      console.debug(`[API] ${response.config.method?.toUpperCase()} ${response.config.url} - ${duration}ms`);
    }
    
    // Transform response to extract data from ApiResponse wrapper if present
    // Backend may return { success: true, data: {...} } or direct data
    if (response.data && typeof response.data === 'object') {
      if (response.data.success !== undefined && response.data.data !== undefined) {
        // Backend uses ApiResponse wrapper
        return {
          ...response,
          data: response.data.data,
          metadata: response.data.metadata,
        };
      }
    }
    
    return response;
  },
  (error) => {
    // Enhanced error logging for network errors
    if (!error.response && error.request) {
      // Network error - server not reachable
      if (process.env.NODE_ENV === 'development') {
        console.error('[API Client] Network Error:', {
          message: error.message,
          code: error.code,
          url: error.config?.url,
          baseURL: error.config?.baseURL || API_BASE_URL,
          method: error.config?.method,
          hint: 'Check if backend server is running and accessible',
        });
      }
    }
    
    // Transform axios errors into typed errors
    if (error.response) {
      // Server responded with error status
      const status = error.response.status;
      const errorData = error.response.data;
      const message = errorData?.error || errorData?.message || error.message || 'An error occurred';
      
      switch (status) {
        case 401:
          // Clear invalid token
          if (localStorage.getItem('authToken')) {
            localStorage.removeItem('authToken');
            localStorage.removeItem('username');
            localStorage.removeItem('passwordChanged');
            // Trigger logout event for components to react
            window.dispatchEvent(new CustomEvent('auth:logout'));
          }
          return Promise.reject(new AuthenticationError(message, error));
          
        case 403:
          return Promise.reject(new AuthenticationError('Access forbidden', error));
          
        case 404:
          return Promise.reject(new NotFoundError(message || 'Resource not found', error));
          
        case 422:
        case 400:
          return Promise.reject(new ValidationError(message, error, errorData?.errors));
          
        case 429:
          return Promise.reject(new RateLimitError(message || 'Rate limit exceeded', error));
          
        case 500:
        case 502:
        case 503:
        case 504:
          return Promise.reject(new ServerError(message || 'Server error', error, status));
          
        default:
          return Promise.reject(new ApiError(message, error, status));
      }
    } else if (error.request) {
      // Request was made but no response received
      return Promise.reject(new NetworkError('Network error - no response from server', error));
    } else {
      // Error setting up request
      return Promise.reject(new NetworkError(error.message || 'Request setup failed', error));
    }
  }
);

/**
 * Validate token format
 */
function isValidToken(token) {
  return token && 
         typeof token === 'string' && 
         token.trim().length > 0 && 
         token !== 'undefined' && 
         token !== 'null';
}

/**
 * Generate unique request ID for correlation
 */
function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * API Methods
 * Organized by resource/domain
 */

// Authentication
export const authApi = {
  login: async (username, password) => {
    const response = await apiClient.post('/api/auth/login', { username, password });
    return response.data;
  },
  
  verifyToken: async () => {
    const response = await apiClient.get('/api/auth/me');
    return response.data;
  },
  
  updatePassword: async (currentPassword, newPassword) => {
    const response = await apiClient.put('/api/auth/password', {
      currentPassword,
      newPassword,
    });
    return response.data;
  },
  
  updateUsername: async (newUsername, password) => {
    const response = await apiClient.put('/api/auth/username', {
      newUsername,
      password,
    });
    return response.data;
  },
};

// Portainer Instances
export const portainerApi = {
  getAll: async () => {
    const response = await apiClient.get('/api/portainer/instances');
    return response.data;
  },
  
  getById: async (id) => {
    const response = await apiClient.get(`/api/portainer/instances/${id}`);
    return response.data;
  },
  
  create: async (instanceData) => {
    const response = await apiClient.post('/api/portainer/instances', instanceData);
    return response.data;
  },
  
  update: async (id, instanceData) => {
    const response = await apiClient.put(`/api/portainer/instances/${id}`, instanceData);
    return response.data;
  },
  
  delete: async (id) => {
    const response = await apiClient.delete(`/api/portainer/instances/${id}`);
    return response.data;
  },
  
  reorder: async (orders) => {
    const response = await apiClient.post('/api/portainer/instances/reorder', { orders });
    return response.data;
  },
};

// Containers
export const containerApi = {
  getAll: async (showLoading = false) => {
    const response = await apiClient.get('/api/containers', {
      params: { showLoading },
    });
    return response.data;
  },
  
  getById: async (id) => {
    const response = await apiClient.get(`/api/containers/${id}`);
    return response.data;
  },
  
  update: async (id, containerData) => {
    const response = await apiClient.put(`/api/containers/${id}`, containerData);
    return response.data;
  },
  
  clearCache: async () => {
    const response = await apiClient.delete('/api/containers/cache');
    return response.data;
  },
};

// Tracked Images
export const trackedImageApi = {
  getAll: async () => {
    const response = await apiClient.get('/api/tracked-images');
    return response.data;
  },
  
  getById: async (id) => {
    const response = await apiClient.get(`/api/tracked-images/${id}`);
    return response.data;
  },
  
  create: async (imageData) => {
    const response = await apiClient.post('/api/tracked-images', imageData);
    return response.data;
  },
  
  update: async (id, imageData) => {
    const response = await apiClient.put(`/api/tracked-images/${id}`, imageData);
    return response.data;
  },
  
  delete: async (id) => {
    const response = await apiClient.delete(`/api/tracked-images/${id}`);
    return response.data;
  },
  
  checkUpdates: async (id) => {
    const response = await apiClient.post(`/api/tracked-images/${id}/check-updates`);
    return response.data;
  },
};

// Batch Operations
export const batchApi = {
  getConfig: async () => {
    const response = await apiClient.get('/api/batch/config');
    return response.data;
  },
  
  updateConfig: async (config) => {
    const response = await apiClient.put('/api/batch/config', config);
    return response.data;
  },
  
  getLogLevel: async () => {
    const response = await apiClient.get('/api/batch/log-level');
    return response.data;
  },
  
  setLogLevel: async (level) => {
    const response = await apiClient.put('/api/batch/log-level', { level });
    return response.data;
  },
  
  createRun: async (runData) => {
    const response = await apiClient.post('/api/batch/runs', runData);
    return response.data;
  },
  
  updateRun: async (runId, runData) => {
    const response = await apiClient.put(`/api/batch/runs/${runId}`, runData);
    return response.data;
  },
  
  getRuns: async (params = {}) => {
    const response = await apiClient.get('/api/batch/runs', { params });
    return response.data;
  },
  
  getRunById: async (runId) => {
    const response = await apiClient.get(`/api/batch/runs/${runId}`);
    return response.data;
  },
};

// Docker Hub Credentials
export const dockerHubApi = {
  getCredentials: async () => {
    const response = await apiClient.get('/api/docker-hub/credentials');
    return response.data;
  },
  
  updateCredentials: async (credentials) => {
    const response = await apiClient.put('/api/docker-hub/credentials', credentials);
    return response.data;
  },
  
  validateCredentials: async (credentials) => {
    const response = await apiClient.post('/api/docker-hub/credentials/validate', credentials);
    return response.data;
  },
  
  deleteCredentials: async () => {
    const response = await apiClient.delete('/api/docker-hub/credentials');
    return response.data;
  },
};

// Discord Webhooks
export const discordApi = {
  getAll: async () => {
    const response = await apiClient.get('/api/discord/webhooks');
    return response.data;
  },
  
  getById: async (id) => {
    const response = await apiClient.get(`/api/discord/webhooks/${id}`);
    return response.data;
  },
  
  create: async (webhookData) => {
    const response = await apiClient.post('/api/discord/webhooks', webhookData);
    return response.data;
  },
  
  update: async (id, webhookData) => {
    const response = await apiClient.put(`/api/discord/webhooks/${id}`, webhookData);
    return response.data;
  },
  
  delete: async (id) => {
    const response = await apiClient.delete(`/api/discord/webhooks/${id}`);
    return response.data;
  },
};

// Settings
export const settingsApi = {
  getColorScheme: async () => {
    const response = await apiClient.get('/api/settings/color-scheme');
    return response.data;
  },
  
  updateColorScheme: async (scheme) => {
    const response = await apiClient.put('/api/settings/color-scheme', { scheme });
    return response.data;
  },
};

// Avatars
export const avatarApi = {
  getAvatar: async (userId, cacheBust = false) => {
    const url = `/api/avatars/${userId}${cacheBust ? `?t=${Date.now()}` : ''}`;
    const response = await apiClient.get(url, {
      responseType: 'blob',
    });
    return response.data;
  },
  
  uploadAvatar: async (file) => {
    const formData = new FormData();
    formData.append('avatar', file);
    const response = await apiClient.post('/api/avatars/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },
  
  getRecentAvatars: async () => {
    const response = await apiClient.get('/api/avatars/recent');
    return response.data;
  },
};

// Export the axios instance for advanced use cases
export { apiClient };

// Export default API methods grouped by domain
export default {
  auth: authApi,
  portainer: portainerApi,
  container: containerApi,
  trackedImage: trackedImageApi,
  batch: batchApi,
  dockerHub: dockerHubApi,
  discord: discordApi,
  settings: settingsApi,
  avatar: avatarApi,
};


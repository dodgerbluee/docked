/**
 * Connection Check Utility
 * Helps diagnose API connection issues
 */

import { API_BASE_URL } from '../constants/api';

/**
 * Check if the API server is reachable
 * @returns {Promise<{reachable: boolean, error?: string, url?: string}>}
 */
export async function checkApiConnection() {
  const healthUrl = `${API_BASE_URL}/api/health/live`;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      return {
        reachable: true,
        url: API_BASE_URL,
        status: response.status,
      };
    } else {
      return {
        reachable: false,
        error: `Server returned status ${response.status}`,
        url: API_BASE_URL,
        status: response.status,
      };
    }
  } catch (error) {
    let errorMessage = 'Unknown error';
    
    if (error.name === 'AbortError') {
      errorMessage = 'Connection timeout - server did not respond within 5 seconds';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    return {
      reachable: false,
      error: errorMessage,
      url: API_BASE_URL,
      details: {
        name: error.name,
        message: error.message,
        code: error.code,
      },
    };
  }
}

/**
 * Log connection status for debugging
 */
export async function logConnectionStatus() {
  if (process.env.NODE_ENV === 'development') {
    const status = await checkApiConnection();
    console.log('[Connection Check]', {
      reachable: status.reachable,
      url: status.url,
      error: status.error,
      details: status.details,
    });
    return status;
  }
  return null;
}


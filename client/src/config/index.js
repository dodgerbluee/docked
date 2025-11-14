/**
 * Configuration Module
 * Centralized configuration management
 * Handles environment variables and application settings
 */

/**
 * Application configuration
 */
const config = {
  // API Configuration
  api: {
    baseUrl: process.env.REACT_APP_API_URL || 
            (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3002'),
    timeout: parseInt(process.env.REACT_APP_API_TIMEOUT || '30000', 10),
  },
  
  // Environment
  env: {
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production',
    isTest: process.env.NODE_ENV === 'test',
  },
  
  // Feature Flags
  features: {
    enableErrorReporting: process.env.REACT_APP_ENABLE_ERROR_REPORTING === 'true',
    enablePerformanceMonitoring: process.env.REACT_APP_ENABLE_PERFORMANCE_MONITORING === 'true',
    enableAnalytics: process.env.REACT_APP_ENABLE_ANALYTICS === 'true',
  },
  
  // Local Storage Keys
  storage: {
    authToken: 'authToken',
    username: 'username',
    userRole: 'userRole',
    passwordChanged: 'passwordChanged',
    colorScheme: 'colorScheme',
    lastPullTime: 'lastPullTime',
  },
  
  // Default Values
  defaults: {
    batchInterval: 60, // minutes
    apiTimeout: 30000, // milliseconds
    pageSize: 50,
  },
  
  // Validation
  validation: {
    minPasswordLength: 6,
    minUsernameLength: 3,
    maxUsernameLength: 50,
  },
};

/**
 * Validate configuration
 */
function validateConfig() {
  const warnings = [];
  
  if (config.env.isProduction) {
    if (!config.api.baseUrl) {
      warnings.push('API base URL not set in production');
    }
    
    if (config.api.baseUrl && config.api.baseUrl.includes('localhost')) {
      warnings.push('API base URL appears to be pointing to localhost in production');
    }
  }
  
  if (warnings.length > 0 && config.env.isDevelopment) {
    console.warn('[Config] Configuration warnings:', warnings);
  }
  
  return warnings;
}

// Validate on load
if (typeof window !== 'undefined') {
  validateConfig();
}

/**
 * Get configuration value by path
 * @param {string} path - Dot-separated path (e.g., 'api.baseUrl')
 * @returns {*} Configuration value
 */
export function getConfig(path) {
  const keys = path.split('.');
  let value = config;
  
  for (const key of keys) {
    if (value && typeof value === 'object' && key in value) {
      value = value[key];
    } else {
      return undefined;
    }
  }
  
  return value;
}

/**
 * Check if feature is enabled
 * @param {string} feature - Feature name
 * @returns {boolean}
 */
export function isFeatureEnabled(feature) {
  return config.features[feature] === true;
}

export default config;


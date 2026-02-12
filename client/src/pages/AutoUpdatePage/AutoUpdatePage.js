import { useState, useEffect } from 'react';
import styles from './AutoUpdatePage.module.css';
import IntentList from './components/IntentList';
import CreateIntentModal from './components/CreateIntentModal';
import TestMatchModal from './components/TestMatchModal';
import ErrorDisplay from '../../components/ErrorDisplay/ErrorDisplay';

/**
 * AutoUpdatePage - Main container for auto-update intents
 * 
 * Manages CRUD operations for auto-update intents:
 * - Fetch list of user's intents
 * - Create new intent
 * - Test matching (dry-run)
 * - Enable/disable intents
 * - Delete intents
 */
export default function AutoUpdatePage() {
  const [intents, setIntents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTestMatchModal, setShowTestMatchModal] = useState(false);
  const [selectedIntent, setSelectedIntent] = useState(null);
  const [testMatchResults, setTestMatchResults] = useState(null);

  // Get auth token from localStorage (following existing app pattern)
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');

  /**
   * Fetch all intents for the current user
   */
  const fetchIntents = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `${process.env.REACT_APP_SERVER}/api/auto-update/intents`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to fetch intents');
      }

      const data = await response.json();
      setIntents(data.intents || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch intents on component mount
  useEffect(() => {
    fetchIntents();
  }, [token]);

  /**
   * Create a new auto-update intent
   */
  const handleCreateIntent = async (intentData) => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER}/api/auto-update/intents`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(intentData),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create intent');
      }

      setShowCreateModal(false);
      await fetchIntents();
    } catch (err) {
      setError(err.message);
    }
  };

  /**
   * Test matching - show which containers would be matched (dry-run)
   */
  const handleTestMatch = async (intent) => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER}/api/auto-update/intents/${intent.id}/test-match`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to test match');
      }

      const results = await response.json();
      setTestMatchResults(results);
      setSelectedIntent(intent);
      setShowTestMatchModal(true);
    } catch (err) {
      setError(err.message);
    }
  };

  /**
   * Enable auto-updates for an intent
   */
  const handleEnable = async (id) => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER}/api/auto-update/intents/${id}/enable`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to enable intent');
      }

      await fetchIntents();
    } catch (err) {
      setError(err.message);
    }
  };

  /**
   * Disable auto-updates for an intent
   */
  const handleDisable = async (id) => {
    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER}/api/auto-update/intents/${id}/disable`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to disable intent');
      }

      await fetchIntents();
    } catch (err) {
      setError(err.message);
    }
  };

  /**
   * Delete an intent
   */
  const handleDelete = async (id) => {
    if (!window.confirm('Delete this auto-update intent? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(
        `${process.env.REACT_APP_SERVER}/api/auto-update/intents/${id}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete intent');
      }

      await fetchIntents();
    } catch (err) {
      setError(err.message);
    }
  };

  /**
   * Close test-match modal and enable the intent
   */
  const handleEnableFromTestMatch = async () => {
    await handleEnable(selectedIntent.id);
    setShowTestMatchModal(false);
  };

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Auto-Update Intents</h1>
          <p className={styles.pageSubtitle}>
            Automatically upgrade containers that match your criteria
          </p>
        </div>
        <button
          className={styles.createButton}
          onClick={() => setShowCreateModal(true)}
        >
          + Create Intent
        </button>
      </div>

      {error && (
        <ErrorDisplay
          message={error}
          onDismiss={() => setError(null)}
        />
      )}

      <IntentList
        intents={intents}
        loading={loading}
        onTestMatch={handleTestMatch}
        onEnable={handleEnable}
        onDisable={handleDisable}
        onDelete={handleDelete}
        onRefresh={fetchIntents}
      />

      <CreateIntentModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateIntent}
      />

      <TestMatchModal
        isOpen={showTestMatchModal}
        intent={selectedIntent}
        results={testMatchResults}
        onClose={() => setShowTestMatchModal(false)}
        onEnable={handleEnableFromTestMatch}
      />
    </div>
  );
}

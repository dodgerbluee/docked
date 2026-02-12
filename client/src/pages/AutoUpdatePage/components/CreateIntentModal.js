import { useState } from 'react';
import styles from './CreateIntentModal.module.css';

/**
 * CreateIntentModal - Form to create or edit an auto-update intent
 * 
 * Props:
 * - isOpen: boolean
 * - intent: null | object (for editing)
 * - onClose: () => void
 * - onSubmit: (intentData) => Promise<void>
 */
export default function CreateIntentModal({ isOpen, intent, onClose, onSubmit }) {
  const [criteriaType, setCriteriaType] = useState(
    intent?.stackName ? 'stackService' : intent?.imageRepo ? 'imageRepo' : 'imageRepo'
  );
  const [formData, setFormData] = useState({
    imageRepo: intent?.imageRepo || '',
    stackName: intent?.stackName || '',
    serviceName: intent?.serviceName || '',
    containerName: intent?.containerName || '',
    description: intent?.description || '',
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    setError(null);
  };

  const validateForm = () => {
    switch (criteriaType) {
      case 'imageRepo':
        if (!formData.imageRepo.trim()) {
          setError('Image repository is required');
          return false;
        }
        break;
      case 'stackService':
        if (!formData.stackName.trim() || !formData.serviceName.trim()) {
          setError('Both stack name and service name are required');
          return false;
        }
        break;
      case 'containerName':
        if (!formData.containerName.trim()) {
          setError('Container name is required');
          return false;
        }
        break;
      default:
        setError('Please select a matching criterion');
        return false;
    }
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      const submitData = {
        description: formData.description.trim() || undefined,
      };

      switch (criteriaType) {
        case 'imageRepo':
          submitData.imageRepo = formData.imageRepo.trim();
          break;
        case 'stackService':
          submitData.stackName = formData.stackName.trim();
          submitData.serviceName = formData.serviceName.trim();
          break;
        case 'containerName':
          submitData.containerName = formData.containerName.trim();
          break;
      }

      await onSubmit(submitData);
    } catch (err) {
      setError(err.message || 'Failed to create intent');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      imageRepo: '',
      stackName: '',
      serviceName: '',
      containerName: '',
      description: '',
    });
    setError(null);
    setCriteriaType('imageRepo');
    onClose();
  };

  return (
    <div className={styles.modalOverlay} onClick={handleClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2 className={styles.modalTitle}>
            {intent ? 'Edit Intent' : 'Create Auto-Update Intent'}
          </h2>
          <button
            className={styles.closeButton}
            onClick={handleClose}
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={styles.errorMessage}>
              <span>⚠️</span> {error}
            </div>
          )}

          <div className={styles.formSection}>
            <h3 className={styles.sectionTitle}>Matching Criteria</h3>
            <p className={styles.sectionDescription}>
              Choose how to match containers for auto-updates
            </p>

            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="criteriaType"
                  value="imageRepo"
                  checked={criteriaType === 'imageRepo'}
                  onChange={(e) => setCriteriaType(e.target.value)}
                />
                <span className={styles.radioText}>Image Repository</span>
              </label>
              {criteriaType === 'imageRepo' && (
                <div className={styles.fieldGroup}>
                  <label htmlFor="imageRepo" className={styles.label}>
                    Image Repository
                  </label>
                  <input
                    id="imageRepo"
                    type="text"
                    name="imageRepo"
                    placeholder="e.g., ghcr.io/linuxserver/plex or nginx"
                    value={formData.imageRepo}
                    onChange={handleChange}
                    className={styles.input}
                  />
                  <p className={styles.fieldHint}>
                    Matches any container using this image across all instances
                  </p>
                </div>
              )}
            </div>

            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="criteriaType"
                  value="stackService"
                  checked={criteriaType === 'stackService'}
                  onChange={(e) => setCriteriaType(e.target.value)}
                />
                <span className={styles.radioText}>Stack + Service (Docker Compose)</span>
              </label>
              {criteriaType === 'stackService' && (
                <div className={styles.fieldGroup}>
                  <div className={styles.twoColumn}>
                    <div>
                      <label htmlFor="stackName" className={styles.label}>
                        Stack Name
                      </label>
                      <input
                        id="stackName"
                        type="text"
                        name="stackName"
                        placeholder="e.g., media"
                        value={formData.stackName}
                        onChange={handleChange}
                        className={styles.input}
                      />
                    </div>
                    <div>
                      <label htmlFor="serviceName" className={styles.label}>
                        Service Name
                      </label>
                      <input
                        id="serviceName"
                        type="text"
                        name="serviceName"
                        placeholder="e.g., plex"
                        value={formData.serviceName}
                        onChange={handleChange}
                        className={styles.input}
                      />
                    </div>
                  </div>
                  <p className={styles.fieldHint}>
                    Most stable after Portainer database wipes
                  </p>
                </div>
              )}
            </div>

            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="criteriaType"
                  value="containerName"
                  checked={criteriaType === 'containerName'}
                  onChange={(e) => setCriteriaType(e.target.value)}
                />
                <span className={styles.radioText}>Container Name</span>
              </label>
              {criteriaType === 'containerName' && (
                <div className={styles.fieldGroup}>
                  <label htmlFor="containerName" className={styles.label}>
                    Container Name
                  </label>
                  <input
                    id="containerName"
                    type="text"
                    name="containerName"
                    placeholder="e.g., my-plex"
                    value={formData.containerName}
                    onChange={handleChange}
                    className={styles.input}
                  />
                  <p className={styles.fieldHint}>
                    Matches a specific container by name
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className={styles.formSection}>
            <label htmlFor="description" className={styles.label}>
              Description (Optional)
            </label>
            <input
              id="description"
              type="text"
              name="description"
              placeholder="e.g., Auto-upgrade Plex to latest version"
              value={formData.description}
              onChange={handleChange}
              className={styles.input}
              maxLength={200}
            />
            <p className={styles.fieldHint}>
              {formData.description.length}/200 characters
            </p>
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={handleClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading}
            >
              {loading ? 'Creating...' : intent ? 'Update Intent' : 'Create Intent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

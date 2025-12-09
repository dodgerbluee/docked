import React, { useState, useCallback } from "react";
import { Info } from "lucide-react";
import Card from "../../ui/Card";
import LoadingSpinner from "../../ui/LoadingSpinner";
import ConfirmDialog from "../../ui/ConfirmDialog";
import { useRepositoryAccessTokens } from "../../../hooks/useRepositoryAccessTokens";
import AddRepositoryAccessTokenModal from "../../AddRepositoryAccessTokenModal";
import AssociateImagesModal from "../AssociateImagesModal";
import { SETTINGS_TABS } from "../../../constants/settings";
import TokenCard from "./components/TokenCard";
import AddTokenCard from "./components/AddTokenCard";
import styles from "./RepositoriesTab.module.css";

/**
 * RepositoriesTab Component
 * Modern interface for managing repository access tokens (GitHub/GitLab)
 */
const RepositoriesTab = React.memo(function RepositoriesTab() {
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [editingToken, setEditingToken] = useState(null);
  const [tokenDeleteConfirm, setTokenDeleteConfirm] = useState({ isOpen: false, tokenId: null });
  const [associateImagesModalOpen, setAssociateImagesModalOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState(null);

  const {
    tokens,
    loading: tokensLoading,
    createOrUpdateToken,
    deleteToken,
  } = useRepositoryAccessTokens({ activeSection: SETTINGS_TABS.REPOSITORIES });

  const handleAddToken = useCallback(() => {
    setEditingToken(null);
    setTokenModalOpen(true);
  }, []);

  const handleEditToken = useCallback((token) => {
    setEditingToken(token);
    setTokenModalOpen(true);
  }, []);

  const handleTokenSave = useCallback(async (provider, name, accessToken, tokenId) => {
    return await createOrUpdateToken(provider, name, accessToken, tokenId);
  }, [createOrUpdateToken]);

  const handleTokenDeleteClick = useCallback((tokenId) => {
    setTokenDeleteConfirm({ isOpen: true, tokenId });
  }, []);

  const handleTokenDeleteConfirm = useCallback(async () => {
    if (tokenDeleteConfirm.tokenId) {
      await deleteToken(tokenDeleteConfirm.tokenId);
    }
    setTokenDeleteConfirm({ isOpen: false, tokenId: null });
  }, [tokenDeleteConfirm.tokenId, deleteToken]);

  const handleAssociateImages = useCallback((token) => {
    setSelectedToken(token);
    setAssociateImagesModalOpen(true);
  }, []);

  const handleAssociateModalClose = useCallback(() => {
    setAssociateImagesModalOpen(false);
    setSelectedToken(null);
  }, []);

  const handleModalClose = useCallback(() => {
    setTokenModalOpen(false);
    setEditingToken(null);
  }, []);

  return (
    <div className={styles.container}>
      {/* Header Section */}
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <div className={styles.titleSection}>
            <h2 className={styles.title}>Repository Access Tokens</h2>
            <p className={styles.subtitle}>
              Manage tokens for GitHub and GitLab to enable update checking for your container images
            </p>
          </div>
        </div>
      </div>

      {/* Info Banner */}
      <Card variant="secondary" padding="md" className={styles.infoBanner}>
        <div className={styles.infoContent}>
          <Info size={20} className={styles.infoIcon} />
          <div className={styles.infoText}>
            <strong>How it works:</strong> Add access tokens for GitHub Container Registry (GHCR) or GitLab Container Registry. 
            Then associate these tokens with your container images to enable automatic update detection for private repositories.
          </div>
        </div>
      </Card>

      {/* Tokens Section */}
      <div className={styles.tokensSection}>
        {tokensLoading ? (
          <div className={styles.loadingContainer}>
            <LoadingSpinner size="md" message="Loading tokens..." />
          </div>
        ) : (
          <>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                {tokens.length === 0 ? "Your Tokens" : `Your Tokens (${tokens.length})`}
              </h3>
            </div>
            <div className={styles.tokensGrid}>
              {tokens.map((token) => (
                <TokenCard
                  key={token.id}
                  token={token}
                  onAssociateImages={() => handleAssociateImages(token)}
                  onEdit={() => handleEditToken(token)}
                  onDelete={() => handleTokenDeleteClick(token.id)}
                  loading={tokensLoading}
                />
              ))}
              <AddTokenCard onClick={handleAddToken} />
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      <AddRepositoryAccessTokenModal
        isOpen={tokenModalOpen}
        onClose={handleModalClose}
        onSuccess={handleTokenSave}
        existingToken={editingToken}
        loading={tokensLoading}
      />

      <ConfirmDialog
        isOpen={tokenDeleteConfirm.isOpen}
        onClose={() => setTokenDeleteConfirm({ isOpen: false, tokenId: null })}
        onConfirm={handleTokenDeleteConfirm}
        title="Delete Access Token?"
        message="Are you sure you want to delete this repository access token? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      <AssociateImagesModal
        isOpen={associateImagesModalOpen}
        onClose={handleAssociateModalClose}
        token={selectedToken}
      />
    </div>
  );
});

RepositoriesTab.propTypes = {};

export default RepositoriesTab;


import React, { useState } from "react";
import { Plus } from "lucide-react";
import Card from "../ui/Card";
import ActionButtons from "../ui/ActionButtons";
import ConfirmDialog from "../ui/ConfirmDialog";
import { useRepositoryAccessTokens } from "../../hooks/useRepositoryAccessTokens";
import AddRepositoryAccessTokenModal from "../AddRepositoryAccessTokenModal";
import GitHubIcon from "../icons/GitHubIcon";
import GitLabIcon from "../icons/GitLabIcon";
import { SETTINGS_TABS } from "../../constants/settings";
import styles from "./RepositoriesTab.module.css";

/**
 * RepositoriesTab Component
 * Manages repository access tokens (GitHub/GitLab)
 */
const RepositoriesTab = React.memo(function RepositoriesTab() {
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [editingToken, setEditingToken] = useState(null);
  const [tokenDeleteConfirm, setTokenDeleteConfirm] = useState({ isOpen: false, tokenId: null });

  const {
    tokens,
    loading: tokensLoading,
    createOrUpdateToken,
    deleteToken,
  } = useRepositoryAccessTokens({ activeSection: SETTINGS_TABS.REPOSITORIES });

  const handleAddToken = () => {
    setEditingToken(null);
    setTokenModalOpen(true);
  };

  const handleEditToken = (token) => {
    setEditingToken(token);
    setTokenModalOpen(true);
  };

  const handleTokenSave = async (provider, name, accessToken, tokenId) => {
    return await createOrUpdateToken(provider, name, accessToken, tokenId);
  };

  const handleTokenDeleteClick = (tokenId) => {
    setTokenDeleteConfirm({ isOpen: true, tokenId });
  };

  const handleTokenDeleteConfirm = async () => {
    if (tokenDeleteConfirm.tokenId) {
      await deleteToken(tokenDeleteConfirm.tokenId);
    }
    setTokenDeleteConfirm({ isOpen: false, tokenId: null });
  };

  const getProviderIcon = (provider) => {
    return provider === "github" ? GitHubIcon : GitLabIcon;
  };

  const getProviderLabel = (provider) => {
    return provider === "github" ? "GitHub" : "GitLab";
  };

  return (
    <div className={styles.updateSection}>
      <h3 className={styles.title}>Manage Repository Access Tokens</h3>
      <p className={styles.description}>
        Manage your repository access tokens for GitHub and GitLab. Add, edit, or remove tokens
        below.
      </p>

      <div className={styles.repositoryTokensSection}>
        <div className={styles.sectionHeader}>
          <h4 className={styles.sectionTitle}>Repository Access Tokens</h4>
        </div>
        <div className={styles.tokensGrid}>
          {tokens.map((token) => {
            const IconComponent = getProviderIcon(token.provider);
            return (
              <Card key={token.id} variant="default" padding="md" className={styles.tokenCard}>
                <div className={styles.tokenContent}>
                  <div className={styles.tokenInfo}>
                    <div className={styles.tokenHeader}>
                      <span className={styles.tokenIcon}>
                        <IconComponent size={18} />
                      </span>
                      <strong className={styles.tokenProvider}>
                        {token.name || getProviderLabel(token.provider)}
                      </strong>
                    </div>
                  </div>
                  <ActionButtons
                    onEdit={() => handleEditToken(token)}
                    onDelete={() => handleTokenDeleteClick(token.id)}
                  />
                </div>
              </Card>
            );
          })}
          <Card
            variant="default"
            padding="md"
            className={styles.addTokenCard}
            onClick={handleAddToken}
          >
            <div className={styles.addTokenContent}>
              <div className={styles.addTokenText}>
                <Plus size={20} className={styles.addTokenIcon} />
                <span>Add Access Token</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <AddRepositoryAccessTokenModal
        isOpen={tokenModalOpen}
        onClose={() => {
          setTokenModalOpen(false);
          setEditingToken(null);
        }}
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
    </div>
  );
});

RepositoriesTab.propTypes = {};

export default RepositoriesTab;

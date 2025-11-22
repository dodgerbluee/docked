/**
 * Repository Token Selector Component
 * Allows selecting an existing token or adding a new one
 */

import React, { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { Plus } from "lucide-react";
import Select from "react-select";
import { useRepositoryAccessTokens } from "../../../hooks/useRepositoryAccessTokens";
import AddRepositoryAccessTokenModal from "../../AddRepositoryAccessTokenModal";
import GitHubIcon from "../../icons/GitHubIcon";
import GitLabIcon from "../../icons/GitLabIcon";
import Button from "../../ui/Button";
import { SETTINGS_TABS } from "../../../constants/settings";
import { selectStyles } from "../utils/selectStyles";
import styles from "./RepositoryTokenSelector.module.css";

function RepositoryTokenSelector({ provider, selectedTokenId, onTokenChange, loading }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const {
    tokens,
    loading: tokensLoading,
    createOrUpdateToken,
    fetchTokens,
  } = useRepositoryAccessTokens({ activeSection: SETTINGS_TABS.PORTAINER });

  // Filter tokens by provider
  const providerTokens = tokens.filter((token) => token.provider === provider);

  useEffect(() => {
    if (provider) {
      fetchTokens();
    }
  }, [provider, fetchTokens]);

  const handleAddToken = async (tokenProvider, name, accessToken, tokenId) => {
    const result = await createOrUpdateToken(tokenProvider, name, accessToken, tokenId);
    if (result && result.success) {
      await fetchTokens();
      // Auto-select the newly created token by ID
      if (result.id) {
        onTokenChange(result.id);
      }
    }
    return result;
  };

  const getProviderLabel = (tokenProvider) => {
    return tokenProvider === "github" ? "GitHub" : "GitLab";
  };

  // Create options for the dropdown, including "None" option
  const tokenOptions = useMemo(() => {
    const options = [
      {
        value: null,
        label: "None (Optional)",
        isDisabled: false,
      },
    ];

    providerTokens.forEach((token) => {
      const IconComponent = token.provider === "github" ? GitHubIcon : GitLabIcon;
      options.push({
        value: token.id,
        label: token.name || `${getProviderLabel(token.provider)} Token`,
        icon: IconComponent,
        hasToken: token.has_token,
      });
    });

    return options;
  }, [providerTokens, provider]);

  const selectedOption = tokenOptions.find((opt) => opt.value === selectedTokenId) || tokenOptions[0];

  const formatOptionLabel = ({ label, icon: IconComponent, hasToken }) => (
    <div className={styles.optionLabel}>
      {IconComponent && (
        <span className={styles.optionIcon}>
          <IconComponent size={16} />
        </span>
      )}
      <span>{label}</span>
      {hasToken === false && <span className={styles.notConfigured}>(not configured)</span>}
    </div>
  );

  return (
    <div className={styles.tokenSelector}>
      <label className={styles.label}>
        {getProviderLabel(provider)} Access Token (Optional)
      </label>
      <div className={styles.tokenSelectWrapper}>
        <Select
          value={selectedOption}
          onChange={(option) => onTokenChange(option.value)}
          options={tokenOptions}
          formatOptionLabel={formatOptionLabel}
          placeholder="Select a token..."
          isSearchable={false}
          isDisabled={loading || tokensLoading}
          styles={selectStyles}
          classNamePrefix="react-select"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowAddModal(true)}
          disabled={loading || tokensLoading}
          icon={Plus}
          className={styles.addTokenButton}
        >
          Add Token
        </Button>
      </div>
      <small className={styles.helperText}>
        Select an existing token or add a new one. Required for private repositories.
      </small>

      <AddRepositoryAccessTokenModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={handleAddToken}
        existingToken={null}
        loading={tokensLoading}
      />
    </div>
  );
}

RepositoryTokenSelector.propTypes = {
  provider: PropTypes.oneOf(["github", "gitlab"]).isRequired,
  selectedTokenId: PropTypes.number,
  onTokenChange: PropTypes.func.isRequired,
  loading: PropTypes.bool,
};

export default RepositoryTokenSelector;


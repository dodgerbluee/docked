/**
 * Repository Token Selector Component
 * Allows selecting an existing token or adding a new one
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import { Plus } from "lucide-react";
import Select from "react-select";
import { useRepositoryAccessTokens } from "../../../hooks/useRepositoryAccessTokens";
import AddRepositoryAccessTokenModal from "../../AddRepositoryAccessTokenModal";
import { getProviderIcon, getProviderLabel } from "../../../utils/providerHelpers";
import Button from "../../ui/Button";
import { SETTINGS_TABS } from "../../../constants/settings";
import { selectStyles } from "../utils/selectStyles";
import styles from "./RepositoryTokenSelector.module.css";

const RepositoryTokenSelector = React.memo(function RepositoryTokenSelector({
  provider,
  selectedTokenId,
  onTokenChange,
  loading,
}) {
  const [showAddModal, setShowAddModal] = useState(false);
  const {
    tokens,
    loading: tokensLoading,
    createOrUpdateToken,
    fetchTokens,
  } = useRepositoryAccessTokens({ activeSection: SETTINGS_TABS.PORTAINER });

  // Filter tokens by provider
  const providerTokens = useMemo(
    () => tokens.filter((token) => token.provider === provider),
    [tokens, provider]
  );

  useEffect(() => {
    if (provider) {
      fetchTokens();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const handleAddToken = useCallback(
    async (tokenProvider, name, accessToken, tokenId) => {
      const result = await createOrUpdateToken(tokenProvider, name, accessToken, tokenId);
      if (result && result.success) {
        await fetchTokens();
        // Auto-select the newly created token by ID
        if (result.id) {
          onTokenChange(result.id);
        }
      }
      return result;
    },
    [createOrUpdateToken, fetchTokens, onTokenChange]
  );

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
      const IconComponent = getProviderIcon(token.provider);
      options.push({
        value: token.id,
        label: token.name || `${getProviderLabel(token.provider)} Token`,
        icon: IconComponent,
        hasToken: token.has_token,
      });
    });

    return options;
  }, [providerTokens]);

  const selectedOption = useMemo(
    () => tokenOptions.find((opt) => opt.value === selectedTokenId) || tokenOptions[0],
    [tokenOptions, selectedTokenId]
  );

  const formatOptionLabel = useCallback(
    ({ label, icon: IconComponent, hasToken }) => (
      <div className={styles.optionLabel}>
        {IconComponent && (
          <span className={styles.optionIcon}>
            <IconComponent size={16} />
          </span>
        )}
        <span>{label}</span>
        {hasToken === false && <span className={styles.notConfigured}>(not configured)</span>}
      </div>
    ),
    []
  );

  const handleTokenChange = useCallback(
    (option) => {
      onTokenChange(option.value);
    },
    [onTokenChange]
  );

  const handleModalClose = useCallback(() => {
    setShowAddModal(false);
  }, []);

  const handleModalOpen = useCallback(() => {
    setShowAddModal(true);
  }, []);

  return (
    <div className={styles.tokenSelector}>
      <label className={styles.label}>{getProviderLabel(provider)} Access Token (Optional)</label>
      <div className={styles.tokenSelectWrapper}>
        <Select
          value={selectedOption}
          onChange={handleTokenChange}
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
          onClick={handleModalOpen}
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
        onClose={handleModalClose}
        onSuccess={handleAddToken}
        existingToken={null}
        loading={tokensLoading}
      />
    </div>
  );
});

RepositoryTokenSelector.propTypes = {
  provider: PropTypes.oneOf(["github", "gitlab"]).isRequired,
  selectedTokenId: PropTypes.number,
  onTokenChange: PropTypes.func.isRequired,
  loading: PropTypes.bool,
};

export default RepositoryTokenSelector;

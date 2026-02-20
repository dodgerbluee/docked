/**
 * GitLab source form component
 */

import React from "react";
import PropTypes from "prop-types";
import Input from "../../ui/Input";
import RepositoryTokenSelector from "./RepositoryTokenSelector";

/**
 * GitLab source form component
 * @param {Object} props
 * @param {string} props.githubRepo - GitLab repository input value
 * @param {number} props.repositoryTokenId - Selected repository token ID
 * @param {Function} props.onChange - Form change handler
 * @param {Function} props.onTokenChange - Token selection change handler
 * @param {boolean} props.loading - Whether form is loading
 */
const GitLabSourceForm = ({ githubRepo, repositoryTokenId, onChange, onTokenChange, loading }) => {
  return (
    <>
      <Input
        label="GitLab Repository"
        name="githubRepo"
        type="text"
        value={githubRepo}
        onChange={onChange}
        required={true}
        placeholder="e.g., owner/repo or https://gitlab.com/owner/repo"
        disabled={loading}
        helperText="GitLab repository in owner/repo format or full GitLab URL"
      />
      <RepositoryTokenSelector
        provider="gitlab"
        selectedTokenId={repositoryTokenId}
        onTokenChange={onTokenChange}
        loading={loading}
      />
    </>
  );
};

GitLabSourceForm.propTypes = {
  githubRepo: PropTypes.string.isRequired,
  repositoryTokenId: PropTypes.number,
  onChange: PropTypes.func.isRequired,
  onTokenChange: PropTypes.func.isRequired,
  loading: PropTypes.bool.isRequired,
};

export default GitLabSourceForm;

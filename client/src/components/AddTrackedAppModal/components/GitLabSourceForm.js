/**
 * GitLab source form component
 */

import React from "react";
import PropTypes from "prop-types";
import Input from "../../ui/Input";

/**
 * GitLab source form component
 * @param {Object} props
 * @param {string} props.githubRepo - GitLab repository input value
 * @param {string} props.gitlabToken - GitLab token input value
 * @param {Function} props.onChange - Form change handler
 * @param {boolean} props.loading - Whether form is loading
 */
const GitLabSourceForm = ({ githubRepo, gitlabToken, onChange, loading }) => {
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
      <Input
        label="GitLab Token (Optional)"
        name="gitlabToken"
        type="password"
        value={gitlabToken}
        onChange={onChange}
        placeholder="Enter GitLab personal access token"
        disabled={loading}
        helperText="Required for private repositories. Leave empty to use GITLAB_TOKEN environment variable or for public repos."
      />
    </>
  );
};

GitLabSourceForm.propTypes = {
  githubRepo: PropTypes.string.isRequired,
  gitlabToken: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  loading: PropTypes.bool.isRequired,
};

export default GitLabSourceForm;


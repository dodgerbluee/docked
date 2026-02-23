/**
 * IntentsPage Component
 * Main page component for the Intents view
 */

import React, { useState, useCallback } from "react";
import PropTypes from "prop-types";
import { Zap } from "lucide-react";
import { useIntents } from "../hooks/useIntents";
import IntentCard from "../components/intents/IntentCard";
import CreateIntentModal from "../components/intents/CreateIntentModal";
import IntentDetailModal from "../components/intents/IntentDetailModal";
import ExecutionDetailModal from "../components/intents/ExecutionDetailModal"; // Used for standalone detail (e.g. after dry run)
import ConfirmDialog from "../components/ui/ConfirmDialog";
import LoadingSpinner from "../components/ui/LoadingSpinner";
import { MAX_INTENTS_PER_USER } from "../constants/intents";
import styles from "./IntentsPage.module.css";

function IntentsPage({ containers = [], portainerInstances = [] }) {
  const {
    intents,
    isLoading,
    hasLoadedOnce,
    error,
    success,
    editingIntentData,
    showCreateModal,
    confirmDialog,
    handleCreateIntent,
    handleUpdateIntent,
    handleDeleteIntent,
    handleToggleIntent,
    handleEditIntent,
    handleModalSuccess,
    handleExecuteIntent,
    handleDryRunIntent,
    fetchExecutionDetail,
    setEditingIntentData,
    setShowCreateModal,
    setConfirmDialog,
    setError,
    setSuccess,
  } = useIntents();

  // Execution history state
  const [detailExecutionId, setDetailExecutionId] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailIntent, setDetailIntent] = useState(null);
  const [detailInitialTab, setDetailInitialTab] = useState(null);

  const handleAddNew = useCallback(() => {
    setEditingIntentData(null);
    setShowCreateModal(true);
  }, [setEditingIntentData, setShowCreateModal]);

  const handleModalClose = useCallback(() => {
    setEditingIntentData(null);
    setShowCreateModal(false);
  }, [setEditingIntentData, setShowCreateModal]);

  const handleModalSubmit = useCallback(
    async (formData) => {
      const isEditing = !!editingIntentData?.id;
      let result;
      if (isEditing) {
        result = await handleUpdateIntent(editingIntentData.id, formData);
      } else {
        result = await handleCreateIntent(formData);
      }
      if (result?.success) {
        await handleModalSuccess();
      }
      return result;
    },
    [editingIntentData, handleCreateIntent, handleUpdateIntent, handleModalSuccess]
  );

  const handleViewHistory = useCallback(
    (intentId) => {
      const intent = intents.find((i) => i.id === intentId);
      if (intent) {
        setDetailIntent(intent);
        setDetailInitialTab("history");
      }
    },
    [intents]
  );

  const handleViewDetails = useCallback((intent) => {
    setDetailIntent(intent);
    setDetailInitialTab(null);
  }, []);

  const handleCloseDetailModal = useCallback(() => {
    setShowDetailModal(false);
    setDetailExecutionId(null);
  }, []);

  const handleDryRun = useCallback(
    async (intentId) => {
      const result = await handleDryRunIntent(intentId);
      if (result?.success) {
        setSuccess(
          `Dry run complete: ${result.execution?.containersMatched ?? 0} container(s) matched`
        );
        setTimeout(() => setSuccess(""), 4000);
        // Open execution detail for the dry run result
        if (result.execution?.executionId) {
          setDetailExecutionId(result.execution.executionId);
          setShowDetailModal(true);
        }
      }
      return result;
    },
    [handleDryRunIntent, setSuccess]
  );

  const canCreateMore = intents.length < MAX_INTENTS_PER_USER;

  return (
    <div className={styles.intentsPage}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h4 className={styles.title}>Intents</h4>
        </div>
      </div>

      {/* Error/Success messages */}
      {error && (
        <div className={styles.errorMessage}>
          {error}
          <button
            className={styles.dismissButton}
            onClick={() => setError("")}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      )}
      {success && <div className={styles.successMessage}>{success}</div>}

      {/* Content */}
      {isLoading && !hasLoadedOnce ? (
        <LoadingSpinner />
      ) : (
        <div className={styles.grid}>
          {intents.map((intent) => (
            <IntentCard
              key={intent.id}
              intent={intent}
              onToggle={handleToggleIntent}
              onExecute={handleExecuteIntent}
              onDryRun={handleDryRun}
              onViewHistory={handleViewHistory}
              onViewDetails={handleViewDetails}
            />
          ))}
          {/* Add card — always visible when under the limit */}
          {canCreateMore && (
            <button
              className={styles.addCard}
              onClick={handleAddNew}
              aria-label="Create new intent"
            >
              <Zap size={24} className={styles.addCardIcon} />
              <span className={styles.addCardText}>Create New Intent</span>
            </button>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      <CreateIntentModal
        isOpen={showCreateModal}
        onClose={handleModalClose}
        onSubmit={handleModalSubmit}
        initialData={editingIntentData}
        containers={containers}
        portainerInstances={portainerInstances}
      />

      {/* Execution Detail Modal (standalone — e.g. after dry run) */}
      <ExecutionDetailModal
        isOpen={showDetailModal}
        onClose={handleCloseDetailModal}
        executionId={detailExecutionId}
        fetchExecutionDetail={fetchExecutionDetail}
      />

      {/* Intent Detail Modal */}
      <IntentDetailModal
        intent={detailIntent}
        isOpen={!!detailIntent}
        onClose={() => {
          setDetailIntent(null);
          setDetailInitialTab(null);
        }}
        onEdit={handleEditIntent}
        onDelete={handleDeleteIntent}
        initialTab={detailInitialTab}
        portainerInstances={portainerInstances}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        variant={confirmDialog.variant || "danger"}
        onConfirm={() => {
          if (confirmDialog.onConfirm) confirmDialog.onConfirm();
        }}
        onClose={() => {
          if (confirmDialog.onClose) {
            confirmDialog.onClose();
          } else {
            setConfirmDialog({
              isOpen: false,
              title: "",
              message: "",
              onConfirm: null,
              onClose: null,
              variant: "danger",
            });
          }
        }}
      />
    </div>
  );
}

IntentsPage.propTypes = {
  containers: PropTypes.array,
  portainerInstances: PropTypes.array,
};

export default IntentsPage;

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
import ExecutionHistoryPanel from "../components/intents/ExecutionHistoryPanel";
import ExecutionDetailModal from "../components/intents/ExecutionDetailModal"; // Used for standalone detail (e.g. after dry run)
import Modal from "../components/ui/Modal";
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
    fetchExecutions,
    fetchExecutionDetail,
    setEditingIntentData,
    setShowCreateModal,
    setConfirmDialog,
    setError,
    setSuccess,
  } = useIntents();

  // Execution history state
  const [historyIntentId, setHistoryIntentId] = useState(null);
  const [detailExecutionId, setDetailExecutionId] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

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

  const handleViewHistory = useCallback((intentId) => {
    setHistoryIntentId(intentId);
  }, []);

  const handleCloseHistory = useCallback(() => {
    setHistoryIntentId(null);
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

  // Find the intent name for the history modal
  const historyIntent = historyIntentId ? intents.find((i) => i.id === historyIntentId) : null;

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
              onEdit={handleEditIntent}
              onDelete={handleDeleteIntent}
              onToggle={handleToggleIntent}
              onExecute={handleExecuteIntent}
              onDryRun={handleDryRun}
              onViewHistory={handleViewHistory}
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

      {/* Execution History Modal */}
      <Modal
        isOpen={!!historyIntentId}
        onClose={handleCloseHistory}
        title={`Execution History${historyIntent?.name ? ` — ${historyIntent.name}` : ""}`}
        size="lg"
      >
        {historyIntentId && (
          <ExecutionHistoryPanel
            intentId={historyIntentId}
            intentName={historyIntent?.name}
            fetchExecutions={fetchExecutions}
            fetchExecutionDetail={fetchExecutionDetail}
          />
        )}
      </Modal>

      {/* Execution Detail Modal (standalone — e.g. after dry run) */}
      <ExecutionDetailModal
        isOpen={showDetailModal}
        onClose={handleCloseDetailModal}
        executionId={detailExecutionId}
        fetchExecutionDetail={fetchExecutionDetail}
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

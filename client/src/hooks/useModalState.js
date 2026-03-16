import { useState, useCallback } from "react";

/**
 * useModalState Hook
 * Manages modal state for AddSourceModal
 */
export function useModalState() {
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [editingSourceInstance, setEditingSourceInstance] = useState(null);

  const openModal = useCallback((instance = null) => {
    setEditingSourceInstance(instance);
    setShowAddSourceModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowAddSourceModal(false);
    setEditingSourceInstance(null);
  }, []);

  return {
    showAddSourceModal,
    editingSourceInstance,
    setShowAddSourceModal,
    setEditingSourceInstance,
    openModal,
    closeModal,
  };
}

import { useState, useCallback } from "react";

/**
 * useModalState Hook
 * Manages modal state for AddPortainerModal
 */
export function useModalState() {
  const [showAddPortainerModal, setShowAddPortainerModal] = useState(false);
  const [editingPortainerInstance, setEditingPortainerInstance] = useState(null);

  const openModal = useCallback((instance = null) => {
    setEditingPortainerInstance(instance);
    setShowAddPortainerModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowAddPortainerModal(false);
    setEditingPortainerInstance(null);
  }, []);

  return {
    showAddPortainerModal,
    editingPortainerInstance,
    setShowAddPortainerModal,
    setEditingPortainerInstance,
    openModal,
    closeModal,
  };
}

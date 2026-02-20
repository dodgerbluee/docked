/**
 * Toast notification utility
 * Simple toast system using browser notifications or console fallback
 * In production, consider using a library like react-toastify or sonner
 */

let toastContainer = null;

/**
 * Initialize toast container
 */
export function initToastContainer() {
  if (typeof document === "undefined") return;

  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    toastContainer.setAttribute("role", "region");
    toastContainer.setAttribute("aria-live", "polite");
    toastContainer.setAttribute("aria-label", "Notifications");
    document.body.appendChild(toastContainer);
  }
}

/**
 * Show a toast notification
 * @param {string} message - Toast message
 * @param {string} type - Toast type (info, success, error, warning)
 * @param {number} duration - Duration in milliseconds (default: 3000)
 * @param {Function} onClick - Optional click handler
 */
export function showToast(message, type = "info", duration = 3000, onClick = null) {
  if (typeof document === "undefined") {
    console.log(`[${type.toUpperCase()}] ${message}`);
    return;
  }

  initToastContainer();

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.setAttribute("role", "alert");
  toast.textContent = message;

  if (onClick) {
    toast.style.cursor = "pointer";
    toast.addEventListener("click", onClick);
  }

  // Add styles if not already present
  if (!document.getElementById("toast-styles")) {
    const style = document.createElement("style");
    style.id = "toast-styles";
    style.textContent = `
      #toast-container {
        position: fixed;
        top: 110px;
        right: 20px;
        z-index: var(--z-toast, 5000);
        display: flex;
        flex-direction: column;
        gap: 12px;
        pointer-events: none;
      }
      .toast {
        background: var(--bg-primary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 12px 16px;
        box-shadow: 0 4px 12px var(--shadow);
        color: var(--text-primary);
        font-size: 0.9rem;
        min-width: 250px;
        max-width: 400px;
        pointer-events: auto;
        animation: toastSlideIn 0.3s ease-out;
      }
      .toast-success {
        border-left: 4px solid var(--success-green);
      }
      .toast-error {
        border-left: 4px solid var(--dodger-red);
      }
      .toast-warning {
        border-left: 4px solid #f59e0b;
      }
      .toast-info {
        border-left: 4px solid var(--dodger-blue);
      }
      @keyframes toastSlideIn {
        from {
          opacity: 0;
          transform: translateX(100%);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
      @keyframes toastSlideOut {
        from {
          opacity: 1;
          transform: translateX(0);
        }
        to {
          opacity: 0;
          transform: translateX(100%);
        }
      }
    `;
    document.head.appendChild(style);
  }

  toastContainer.appendChild(toast);

  // Auto remove after duration
  setTimeout(() => {
    toast.style.animation = "toastSlideOut 0.3s ease-out";
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);

  return toast;
}

/**
 * Convenience methods
 */
export const toast = {
  success: (message, duration) => showToast(message, "success", duration),
  error: (message, duration) => showToast(message, "error", duration),
  warning: (message, duration) => showToast(message, "warning", duration),
  info: (message, duration) => showToast(message, "info", duration),
};

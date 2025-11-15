import { useEffect } from "react";

/**
 * Custom hook for matching sidebar height to stacks container height
 * Ensures sidebar never goes below minimum required height for content
 * Uses MutationObserver to watch for content changes and requestAnimationFrame for smooth updates
 *
 * @param {string} activeTab - The currently active tab name
 *
 * @example
 * useSidebarHeight("portainer");
 */
export const useSidebarHeight = (activeTab) => {
  useEffect(() => {
    if (activeTab !== "portainer") return;

    let isUpdating = false;
    let rafId = null;

    const updateSidebarHeight = () => {
      // Prevent infinite loops
      if (isUpdating) return;

      const stacksContainer = document.querySelector(".stacks-container");
      const sidebar = document.querySelector(".portainer-sidebar");

      if (!sidebar) {
        return;
      }

      isUpdating = true;

      // Use requestAnimationFrame to batch DOM reads/writes and avoid layout thrashing
      if (rafId) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(() => {
        try {
          // Temporarily set height to auto to measure natural content height
          sidebar.style.height = "auto";

          // Force a reflow to get accurate measurements
          void sidebar.offsetHeight;

          // Get the natural content height (scrollHeight includes all content including Add Instance button)
          // This is the minimum height needed to show all sidebar content
          const minRequiredHeight = sidebar.scrollHeight;

          // Get stacks container height
          let finalHeight = minRequiredHeight;
          if (stacksContainer && stacksContainer.offsetHeight > 0) {
            const stacksHeight = stacksContainer.offsetHeight;

            // Match stacks height, but never go below minimum required height
            // This ensures sidebar matches stacks when tall, but never cuts off content when short
            finalHeight = Math.max(stacksHeight, minRequiredHeight);
          }

          sidebar.style.height = `${finalHeight}px`;
        } catch (error) {
          console.error("Error updating sidebar height:", error);
          // Fallback to auto if something goes wrong
          sidebar.style.height = "auto";
        } finally {
          isUpdating = false;
          rafId = null;
        }
      });
    };

    // Update on mount and when content changes
    updateSidebarHeight();

    // Use MutationObserver to watch for content changes, but ignore style changes to prevent loops
    const observer = new MutationObserver((mutations) => {
      // Only update if the mutation is not a style change on the sidebar itself
      const shouldUpdate = mutations.some((mutation) => {
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
          // Ignore style changes on the sidebar itself to prevent loops
          return mutation.target !== document.querySelector(".portainer-sidebar");
        }
        return true;
      });

      if (shouldUpdate) {
        updateSidebarHeight();
      }
    });

    const stacksContainer = document.querySelector(".stacks-container");
    const sidebar = document.querySelector(".portainer-sidebar");

    if (stacksContainer) {
      observer.observe(stacksContainer, {
        childList: true,
        subtree: true,
        attributes: false, // Don't watch attributes to reduce triggers
      });
    }

    // Observe sidebar for structural changes (not style)
    if (sidebar) {
      observer.observe(sidebar, {
        childList: true,
        subtree: true,
        attributes: false, // Don't watch attributes to prevent loops
      });
    }

    // Also update on window resize (debounced)
    let resizeTimeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(updateSidebarHeight, 100);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      clearTimeout(resizeTimeout);
    };
  }, [activeTab]);
};

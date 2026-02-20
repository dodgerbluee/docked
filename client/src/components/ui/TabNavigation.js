import React, { useRef, useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import styles from "./TabNavigation.module.css";

/**
 * TabNavigation Component
 * Reusable tab navigation component for consistent tab UI across the application
 */
const TabNavigation = React.memo(function TabNavigation({
  tabs,
  activeTab,
  onTabChange,
  labels,
  disabledTabs = [],
  className = "",
}) {
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 2;
    setCanScrollLeft(el.scrollLeft > threshold);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - threshold);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);

    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll, tabs]);

  return (
    <div
      className={`${styles.tabsContainer} ${className} ${
        canScrollLeft ? styles.fadeLeft : ""
      } ${canScrollRight ? styles.fadeRight : ""}`}
    >
      <div className={styles.tabsLeft} ref={scrollRef}>
        {tabs.map((tab) => {
          const isDisabled = disabledTabs.includes(tab);
          return (
            <button
              key={tab}
              className={`${styles.tab} ${activeTab === tab ? styles.active : ""} ${
                isDisabled ? styles.disabled : ""
              }`}
              onClick={() => !isDisabled && onTabChange(tab)}
              disabled={isDisabled}
              aria-selected={activeTab === tab}
              role="tab"
            >
              {labels[tab] || tab}
            </button>
          );
        })}
      </div>
    </div>
  );
});

TabNavigation.propTypes = {
  tabs: PropTypes.arrayOf(PropTypes.string).isRequired,
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
  labels: PropTypes.objectOf(PropTypes.string).isRequired,
  disabledTabs: PropTypes.arrayOf(PropTypes.string),
  className: PropTypes.string,
};

export default TabNavigation;

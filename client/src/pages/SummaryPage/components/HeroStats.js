import React from "react";
import PropTypes from "prop-types";
import { Server, Package, RefreshCw, AlertCircle, CheckCircle } from "lucide-react";
import { CONTENT_TABS, PORTAINER_CONTENT_TABS } from "../../../constants/summaryPage";
import styles from "./HeroStats.module.css";

/**
 * Hero stats section displaying key metrics at a glance
 */
const HeroStats = ({
  stats,
  shouldShowEmptyState,
  onPortainerStatClick,
  onTrackedAppsClick,
}) => {
  const heroCards = [];

  heroCards.push({
      id: "containers",
      icon: Server,
      label: "Total Containers",
      value: shouldShowEmptyState ? 0 : stats.totalContainers,
      color: "blue",
      clickable: !shouldShowEmptyState,
      onClick: () => {
        if (!shouldShowEmptyState && onPortainerStatClick) {
          onPortainerStatClick(CONTENT_TABS.ALL);
        }
      },
    });

    heroCards.push({
      id: "updates",
      icon: RefreshCw,
      label: "Updates Available",
      value: shouldShowEmptyState ? 0 : stats.containersWithUpdates,
      color: stats.containersWithUpdates > 0 ? "orange" : "green",
      clickable: !shouldShowEmptyState,
      onClick: () => {
        if (!shouldShowEmptyState && onPortainerStatClick) {
          onPortainerStatClick(CONTENT_TABS.UPDATES);
        }
      },
      highlight: stats.containersWithUpdates > 0,
    });

    heroCards.push({
      id: "upToDate",
      icon: CheckCircle,
      label: "Up to Date",
      value: shouldShowEmptyState ? 0 : stats.containersUpToDate,
      color: "green",
      clickable: !shouldShowEmptyState,
      onClick: () => {
        if (!shouldShowEmptyState && onPortainerStatClick) {
          onPortainerStatClick(CONTENT_TABS.CURRENT);
        }
      },
    });

    heroCards.push({
      id: "unusedImages",
      icon: AlertCircle,
      label: "Unused Images",
      value: shouldShowEmptyState ? 0 : stats.unusedImages,
      color: "purple",
      clickable: !shouldShowEmptyState,
      onClick: () => {
        if (!shouldShowEmptyState && onPortainerStatClick) {
          onPortainerStatClick(CONTENT_TABS.UNUSED);
        }
      },
      subtext: stats.unusedImages > 0 ? "Can be cleaned up" : null,
    });

  heroCards.push({
      id: "trackedApps",
      icon: Package,
      label: "Tracked Apps",
      value: stats.totalTrackedApps,
      color: "indigo",
      clickable: true,
      onClick: onTrackedAppsClick,
      subtext:
        stats.trackedAppsBehind > 0 ? `${stats.trackedAppsBehind} need updates` : "All up to date",
    });

  return (
    <div className={styles.heroStats}>
      {heroCards.map((card) => {
        const Icon = card.icon;
        const cardClasses = [
          styles.heroCard,
          styles[`color${card.color.charAt(0).toUpperCase() + card.color.slice(1)}`],
          card.clickable && styles.clickable,
          card.highlight && styles.highlight,
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={card.id}
            className={cardClasses}
            onClick={card.clickable ? card.onClick : undefined}
            role={card.clickable ? "button" : undefined}
            tabIndex={card.clickable ? 0 : undefined}
            onKeyDown={
              card.clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      card.onClick();
                    }
                  }
                : undefined
            }
          >
            <div className={styles.cardIcon}>
              <Icon size={28} />
            </div>
            <div className={styles.cardContent}>
              <div className={styles.cardValue}>{card.value}</div>
              <div className={styles.cardLabel}>{card.label}</div>
              {card.subtext && <div className={styles.cardSubtext}>{card.subtext}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

HeroStats.propTypes = {
  stats: PropTypes.object.isRequired,
  shouldShowEmptyState: PropTypes.bool,
  onPortainerStatClick: PropTypes.func,
  onTrackedAppsClick: PropTypes.func,
};

export default HeroStats;

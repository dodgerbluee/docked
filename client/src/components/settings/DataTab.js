import React, { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import Button from "../ui/Button";
import Card from "../ui/Card";
import Alert from "../ui/Alert";
import SearchInput from "../ui/SearchInput";
import { CardSkeleton } from "../ui/LoadingSkeleton";
import styles from "./DataTab.module.css";
import { useDeveloperMode } from "./DataTab/hooks/useDeveloperMode";
import { useContainerData } from "./DataTab/hooks/useContainerData";
import { useContainerExpansion } from "./DataTab/hooks/useContainerExpansion";
import { useDataTabSearch } from "./DataTab/hooks/useDataTabSearch";
import ContainerDataList from "./DataTab/components/ContainerDataList";
import { formatDate } from "./DataTab/utils/containerDataProcessing";

/**
 * DataTab Component
 * Displays container data from database with expandable JSON view (developer mode only)
 */
function DataTab() {
  // Use extracted hooks
  const { developerModeEnabled, checkingDeveloperMode } = useDeveloperMode();
  const { dataEntries, loading, error, fetchContainerData } = useContainerData();
  const { searchQuery, setSearchQuery, filteredDataEntries } = useDataTabSearch(dataEntries);
  const {
    expandedContainers,
    toggleContainerExpansion,
    expandAllContainers,
    collapseAllContainers,
    areAllExpanded,
  } = useContainerExpansion(filteredDataEntries);
  const containerDataListRef = useRef(null);
  const [viewMode, setViewMode] = useState("formatted"); // Track view mode
  const [rawRecordsExpanded, setRawRecordsExpanded] = useState(false);

  if (checkingDeveloperMode || loading) {
    return (
      <div className={styles.dataTab}>
        <CardSkeleton />
      </div>
    );
  }

  // If developer mode is not enabled, show message
  if (!developerModeEnabled) {
    return (
      <div className={styles.dataTab}>
        <Card>
          <Alert variant="warning">
            Data viewer is only available when Developer Mode is enabled. Enable it in General
            Settings.
          </Alert>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.dataTab}>
      <Card>
        <div className={styles.headerWrapper}>
          <div className={styles.header}>
            <div className={styles.headerTitle}>
              <h3 className={styles.title}>Portainer Data</h3>
              {dataEntries.length > 0 && dataEntries[0] && (
                <div className={styles.lastPulledInfo}>
                  {dataEntries[0].lastPortainerPull && (
                    <span className={styles.lastPulled}>
                      Last Portainer pull: {formatDate(dataEntries[0].lastPortainerPull)}
                    </span>
                  )}
                  {dataEntries[0].lastDockerHubPull && (
                    <span className={styles.lastPulled}>
                      Last Docker Hub pull: {formatDate(dataEntries[0].lastDockerHubPull)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className={styles.actions}>
              {dataEntries.length > 0 && (
                <>
                  <SearchInput
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search entries..."
                    className={styles.searchInput}
                  />
                  {viewMode === "formatted" ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (areAllExpanded()) {
                          collapseAllContainers();
                        } else {
                          expandAllContainers();
                        }
                      }}
                      size="sm"
                    >
                      {areAllExpanded() ? "Collapse All" : "Expand All"}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (rawRecordsExpanded) {
                          containerDataListRef.current?.collapseAllRawRecords();
                          setRawRecordsExpanded(false);
                        } else {
                          containerDataListRef.current?.expandAllRawRecords();
                          setRawRecordsExpanded(true);
                        }
                      }}
                      size="sm"
                    >
                      {rawRecordsExpanded ? "Collapse All" : "Expand All"}
                    </Button>
                  )}
                </>
              )}
              <Button
                variant="outline"
                onClick={fetchContainerData}
                icon={RefreshCw}
                iconPosition="left"
                size="sm"
              >
                Refresh
              </Button>
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="error" className={styles.error}>
            {error}
          </Alert>
        )}

        <div className={styles.content}>
          <ContainerDataList
            ref={containerDataListRef}
            dataEntries={filteredDataEntries}
            expandedContainers={expandedContainers}
            onToggleExpansion={toggleContainerExpansion}
            rawDatabaseRecords={
              dataEntries.length > 0 && dataEntries[0]?.rawDatabaseRecords
                ? dataEntries[0].rawDatabaseRecords
                : null
            }
            searchQuery={searchQuery}
            onViewModeChange={(mode) => {
              setViewMode(mode);
              if (mode === "formatted") {
                setRawRecordsExpanded(false);
              }
            }}
          />
        </div>
      </Card>
    </div>
  );
}

DataTab.propTypes = {};

export default DataTab;

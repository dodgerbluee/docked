import { useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";

/**
 * useExport Hook
 * Reusable hook for exporting data to JSON files
 * Handles the common pattern of fetching data and downloading as JSON
 */
export function useExport() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportSuccess, setExportSuccess] = useState("");

  const handleExport = async (endpoint, filenamePrefix, successMessage = "Export successful!") => {
    setExporting(true);
    setExportError("");
    setExportSuccess("");

    try {
      const response = await axios.get(`${API_BASE_URL}${endpoint}`);

      if (response.data.success) {
        const jsonString = JSON.stringify(response.data.data, null, 2);
        const blob = new Blob([jsonString], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = `${filenamePrefix}-${new Date().toISOString().split("T")[0]}.json`;
        document.body.appendChild(link);
        link.click();

        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        setExportSuccess(successMessage);
        setTimeout(() => setExportSuccess(""), 3000);
      } else {
        setExportError(response.data.error || "Failed to export data");
      }
    } catch (err) {
      console.error("Error exporting data:", err);
      setExportError(
        err.response?.data?.error || "Failed to export data. Please try again."
      );
    } finally {
      setExporting(false);
    }
  };

  return {
    exporting,
    exportError,
    exportSuccess,
    handleExport,
    setExportError,
    setExportSuccess,
  };
}


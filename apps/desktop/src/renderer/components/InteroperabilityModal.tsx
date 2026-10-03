import React, { useState, useEffect } from "react";
import { desktopBridge } from "../adapter/desktop-bridge.js";
import type { RestorePlan } from "@reflowpress/sync";
import type { DeviceDescriptor, TransferResult } from "@reflowpress/device";
import type { LibraryCatalog } from "@reflowpress/library";

export interface InteroperabilityModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly initialTab?: "opds" | "sync" | "backup" | "device";
}

export const InteroperabilityModal: React.FC<InteroperabilityModalProps> = ({
  isOpen,
  onClose,
  initialTab = "opds",
}) => {
  const [activeTab, setActiveTab] = useState<
    "opds" | "sync" | "backup" | "device"
  >(initialTab);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // OPDS State
  const [opdsRunning, setOpdsRunning] = useState(false);
  const [opdsUrl, setOpdsUrl] = useState<string>("");
  const [opdsPort, setOpdsPort] = useState(3000);
  const [opdsAllowLan, setOpdsAllowLan] = useState(false);

  // Sync State
  const [folderPath, setFolderPath] = useState("");
  const [syncDryRun, setSyncDryRun] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [webdavUrl, setWebdavUrl] = useState("");
  const [webdavUser, setWebdavUser] = useState("");
  const [webdavPassword, setWebdavPassword] = useState("");

  // Backup & Restore State
  const [restoreBundlePath, setRestoreBundlePath] = useState("");
  const [restorePlan, setRestorePlan] = useState<RestorePlan | null>(null);
  const [restorePolicy, setRestorePolicy] = useState<
    "keep-local" | "keep-remote" | "keep-both"
  >("keep-local");
  const [backupResult, setBackupResult] = useState<string | null>(null);

  // Device Transfer State
  const [deviceMountPath, setDeviceMountPath] = useState("");
  const [detectedDevices, setDetectedDevices] = useState<
    readonly DeviceDescriptor[]
  >([]);
  const [libraryBooks, setLibraryBooks] = useState<LibraryCatalog["books"]>([]);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(
    new Set(),
  );
  const [transferResult, setTransferResult] = useState<TransferResult | null>(
    null,
  );

  useEffect(() => {
    if (!isOpen) return;

    // Load initial OPDS status
    desktopBridge
      .opdsGetStatus()
      .then((status) => {
        setOpdsRunning(status.running);
        if (status.url) setOpdsUrl(status.url);
        if (status.port) setOpdsPort(status.port);
        if (status.isLan !== undefined) setOpdsAllowLan(status.isLan);
      })
      .catch(() => {});

    // Load library books for device transfer
    desktopBridge
      .loadLibrary()
      .then((catalog) => {
        setLibraryBooks(catalog.books);
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  // Handlers
  const handleStartOpds = async () => {
    try {
      setErrorMessage(null);
      const info = await desktopBridge.opdsStart({
        port: opdsPort,
        allowLan: opdsAllowLan,
      });
      setOpdsRunning(true);
      setOpdsUrl(info.url);
      setStatusMessage(`OPDS 2.0 Server started on ${info.url}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStopOpds = async () => {
    try {
      await desktopBridge.opdsStop();
      setOpdsRunning(false);
      setStatusMessage("OPDS Server stopped.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSelectFolder = async () => {
    const dir = await desktopBridge.openDirectoryDialog();
    if (dir) setFolderPath(dir);
  };

  const handleFolderSync = async () => {
    if (!folderPath) {
      setErrorMessage("Please select a target sync directory.");
      return;
    }
    try {
      setErrorMessage(null);
      setStatusMessage("Running folder sync...");
      const result = await desktopBridge.syncFolder(folderPath, {
        dryRun: syncDryRun,
      });
      setSyncResult(
        `Sync completed (${syncDryRun ? "Dry Run" : "Applied"}): Total ${result.totalBooks} books, ` +
          `Applied ${result.appliedRemote} remote changes, Encountered ${result.conflicts} conflicts.`,
      );
      setStatusMessage(null);
    } catch (err) {
      setStatusMessage(null);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleWebdavSync = async () => {
    if (!webdavUrl) {
      setErrorMessage("Please specify WebDAV URL.");
      return;
    }
    try {
      setErrorMessage(null);
      setStatusMessage("Running WebDAV sync...");
      const result = await desktopBridge.syncWebdav(
        webdavUrl,
        webdavUser,
        webdavPassword,
        {
          dryRun: syncDryRun,
        },
      );
      setSyncResult(
        `WebDAV sync completed (${syncDryRun ? "Dry Run" : "Applied"}): Total ${result.totalBooks} books, ` +
          `Applied ${result.appliedRemote} remote changes, Encountered ${result.conflicts} conflicts.`,
      );
      setStatusMessage(null);
    } catch (err) {
      setStatusMessage(null);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateBackup = async () => {
    const defaultName = `reflowpress-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const targetPath = await desktopBridge.showSaveFileDialog({
      title: "Save ReflowPress Backup Bundle",
      defaultPath: defaultName,
      filters: [{ name: "ReflowPress Backup JSON", extensions: ["json"] }],
    });
    if (!targetPath) return;

    try {
      setErrorMessage(null);
      const res = await desktopBridge.createBackup(targetPath);
      setBackupResult(
        `Backup successfully saved: ${res.outputPath} (${res.count} publications).`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSelectRestoreFile = async () => {
    const file = await desktopBridge.openFileDialog();
    if (file) {
      setRestoreBundlePath(file);
      setRestorePlan(null);
    }
  };

  const handlePreviewRestore = async () => {
    if (!restoreBundlePath) return;
    try {
      setErrorMessage(null);
      const plan = await desktopBridge.previewRestore(restoreBundlePath);
      setRestorePlan(plan);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleApplyRestore = async () => {
    if (!restoreBundlePath) return;
    try {
      setErrorMessage(null);
      const res = await desktopBridge.applyRestore(
        restoreBundlePath,
        restorePolicy,
      );
      setStatusMessage(
        `Restore completed: ${res.restoredBooks} books restored, ${res.resolvedConflicts} conflicts resolved.`,
      );
      setRestorePlan(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDiscoverDevices = async () => {
    try {
      setErrorMessage(null);
      const devices = await desktopBridge.discoverDevices(
        deviceMountPath || undefined,
      );
      setDetectedDevices(devices);
      if (devices.length === 0) {
        setStatusMessage("No e-reader device found at specified location.");
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSelectAllBooks = () => {
    if (selectedBookIds.size === libraryBooks.length) {
      setSelectedBookIds(new Set());
    } else {
      setSelectedBookIds(new Set(libraryBooks.map((b) => b.id)));
    }
  };

  const handleTransferToDevice = async () => {
    if (!deviceMountPath) {
      setErrorMessage("Please select device mount path.");
      return;
    }
    if (selectedBookIds.size === 0) {
      setErrorMessage("Please select at least one publication to transfer.");
      return;
    }
    try {
      setErrorMessage(null);
      setStatusMessage("Transferring selected publications to device...");
      const result = await desktopBridge.transferToDevice(
        deviceMountPath,
        Array.from(selectedBookIds),
      );
      setTransferResult(result);
      setStatusMessage(null);
    } catch (err) {
      setStatusMessage(null);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="interop-modal-title"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        className="modal-card"
        style={{
          backgroundColor: "var(--color-bg, #ffffff)",
          color: "var(--color-text, #1a1a1a)",
          borderRadius: "8px",
          width: "92%",
          maxWidth: "800px",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.2)",
          padding: "24px",
          boxSizing: "border-box",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h2
            id="interop-modal-title"
            style={{ margin: 0, fontSize: "1.25rem" }}
          >
            Interoperability & Data Portability
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: "none",
              border: "none",
              fontSize: "1.5rem",
              cursor: "pointer",
              color: "inherit",
            }}
          >
            &times;
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          role="tablist"
          style={{
            display: "flex",
            gap: "8px",
            borderBottom: "1px solid var(--color-border, #e0e0e0)",
            marginBottom: "16px",
          }}
        >
          {(
            [
              { id: "opds", label: "OPDS 2.0 Catalog" },
              { id: "sync", label: "Library Sync" },
              { id: "backup", label: "Backup & Restore" },
              { id: "device", label: "E-Reader Devices" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setErrorMessage(null);
                setStatusMessage(null);
              }}
              style={{
                padding: "8px 16px",
                border: "none",
                background: "none",
                cursor: "pointer",
                fontWeight: activeTab === tab.id ? "600" : "normal",
                color:
                  activeTab === tab.id
                    ? "var(--color-primary, #0066cc)"
                    : "inherit",
                borderBottom:
                  activeTab === tab.id
                    ? "2px solid var(--color-primary, #0066cc)"
                    : "2px solid transparent",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Alerts */}
        {errorMessage && (
          <div
            role="alert"
            style={{
              padding: "10px 14px",
              backgroundColor: "#fde8e8",
              color: "#c81e1e",
              borderRadius: "6px",
              marginBottom: "14px",
              fontSize: "0.9rem",
            }}
          >
            {errorMessage}
          </div>
        )}

        {statusMessage && (
          <div
            role="status"
            aria-live="polite"
            style={{
              padding: "10px 14px",
              backgroundColor: "#def7ec",
              color: "#03543f",
              borderRadius: "6px",
              marginBottom: "14px",
              fontSize: "0.9rem",
            }}
          >
            {statusMessage}
          </div>
        )}

        {/* Content Area */}
        <div style={{ flex: 1, overflowY: "auto", paddingRight: "4px" }}>
          {/* TAB 1: OPDS */}
          {activeTab === "opds" && (
            <div>
              <p
                style={{
                  margin: "0 0 16px 0",
                  fontSize: "0.9rem",
                  color: "#666",
                }}
              >
                Share your library with OPDS-compatible reader applications
                (e.g. Moon+ Reader, Thorium, Panels, Foliate) on your local
                network.
              </p>

              <div
                style={{
                  border: "1px solid var(--color-border, #e0e0e0)",
                  borderRadius: "6px",
                  padding: "16px",
                  marginBottom: "16px",
                }}
              >
                <h3 style={{ margin: "0 0 12px 0", fontSize: "1rem" }}>
                  Local OPDS 2.0 Server
                </h3>
                <div
                  style={{
                    display: "flex",
                    gap: "16px",
                    alignItems: "center",
                    marginBottom: "12px",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>Port:</span>
                    <input
                      type="number"
                      value={opdsPort}
                      disabled={opdsRunning}
                      onChange={(e) =>
                        setOpdsPort(parseInt(e.target.value, 10) || 3000)
                      }
                      style={{ width: "80px", padding: "4px 8px" }}
                    />
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={opdsAllowLan}
                      disabled={opdsRunning}
                      onChange={(e) => setOpdsAllowLan(e.target.checked)}
                    />
                    <span>Allow LAN access (bind 0.0.0.0)</span>
                  </label>
                </div>

                <div
                  style={{ display: "flex", gap: "12px", alignItems: "center" }}
                >
                  {!opdsRunning ? (
                    <button
                      onClick={handleStartOpds}
                      style={{
                        padding: "8px 16px",
                        backgroundColor: "var(--color-primary, #0066cc)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Start OPDS Server
                    </button>
                  ) : (
                    <button
                      onClick={handleStopOpds}
                      style={{
                        padding: "8px 16px",
                        backgroundColor: "#c81e1e",
                        color: "#fff",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Stop OPDS Server
                    </button>
                  )}
                  {opdsRunning && (
                    <span
                      style={{
                        fontSize: "0.9rem",
                        color: "#03543f",
                        fontWeight: 600,
                      }}
                    >
                      Running:{" "}
                      <code style={{ userSelect: "all" }}>{opdsUrl}</code>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SYNC */}
          {activeTab === "sync" && (
            <div>
              <p
                style={{
                  margin: "0 0 16px 0",
                  fontSize: "0.9rem",
                  color: "#666",
                }}
              >
                Keep your publications, reading positions, and annotations
                synchronized across devices using a shared folder (Syncthing,
                Dropbox, local drive) or private WebDAV server.
              </p>

              <div style={{ marginBottom: "16px" }}>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={syncDryRun}
                    onChange={(e) => setSyncDryRun(e.target.checked)}
                  />
                  <span>
                    Simulate synchronization (dry-run, do not write changes)
                  </span>
                </label>
              </div>

              {/* Folder Sync */}
              <div
                style={{
                  border: "1px solid var(--color-border, #e0e0e0)",
                  borderRadius: "6px",
                  padding: "16px",
                  marginBottom: "16px",
                }}
              >
                <h3 style={{ margin: "0 0 12px 0", fontSize: "1rem" }}>
                  Shared Folder Sync
                </h3>
                <div
                  style={{ display: "flex", gap: "8px", marginBottom: "12px" }}
                >
                  <input
                    type="text"
                    placeholder="Path to sync folder..."
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    style={{ flex: 1, padding: "6px 10px" }}
                  />
                  <button
                    onClick={handleSelectFolder}
                    style={{ padding: "6px 12px", cursor: "pointer" }}
                  >
                    Browse...
                  </button>
                </div>
                <button
                  onClick={handleFolderSync}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "var(--color-primary, #0066cc)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Sync Folder Now
                </button>
              </div>

              {/* WebDAV Sync */}
              <div
                style={{
                  border: "1px solid var(--color-border, #e0e0e0)",
                  borderRadius: "6px",
                  padding: "16px",
                  marginBottom: "16px",
                }}
              >
                <h3 style={{ margin: "0 0 12px 0", fontSize: "1rem" }}>
                  WebDAV Remote Sync
                </h3>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    marginBottom: "12px",
                  }}
                >
                  <input
                    type="text"
                    placeholder="WebDAV URL (e.g. https://cloud.example.com/remote.php/webdav/ReflowPress/)"
                    value={webdavUrl}
                    onChange={(e) => setWebdavUrl(e.target.value)}
                    style={{ padding: "6px 10px" }}
                  />
                  <div style={{ display: "flex", gap: "10px" }}>
                    <input
                      type="text"
                      placeholder="Username"
                      value={webdavUser}
                      onChange={(e) => setWebdavUser(e.target.value)}
                      style={{ flex: 1, padding: "6px 10px" }}
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={webdavPassword}
                      onChange={(e) => setWebdavPassword(e.target.value)}
                      style={{ flex: 1, padding: "6px 10px" }}
                    />
                  </div>
                </div>
                <button
                  onClick={handleWebdavSync}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "var(--color-primary, #0066cc)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Sync WebDAV Now
                </button>
              </div>

              {syncResult && (
                <div
                  style={{
                    padding: "12px",
                    backgroundColor: "#f3f4f6",
                    borderRadius: "6px",
                    fontSize: "0.9rem",
                  }}
                >
                  {syncResult}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: BACKUP & RESTORE */}
          {activeTab === "backup" && (
            <div>
              <p
                style={{
                  margin: "0 0 16px 0",
                  fontSize: "0.9rem",
                  color: "#666",
                }}
              >
                Export a self-contained portable snapshot of your library
                catalog, annotations, and bookmarks, or restore from a previous
                backup bundle.
              </p>

              {/* Backup section */}
              <div
                style={{
                  border: "1px solid var(--color-border, #e0e0e0)",
                  borderRadius: "6px",
                  padding: "16px",
                  marginBottom: "16px",
                }}
              >
                <h3 style={{ margin: "0 0 12px 0", fontSize: "1rem" }}>
                  Create Backup Bundle
                </h3>
                <button
                  onClick={handleCreateBackup}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "var(--color-primary, #0066cc)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Export Backup Bundle (.json)
                </button>
                {backupResult && (
                  <p
                    style={{
                      margin: "10px 0 0 0",
                      fontSize: "0.9rem",
                      color: "#03543f",
                    }}
                  >
                    {backupResult}
                  </p>
                )}
              </div>

              {/* Restore section */}
              <div
                style={{
                  border: "1px solid var(--color-border, #e0e0e0)",
                  borderRadius: "6px",
                  padding: "16px",
                }}
              >
                <h3 style={{ margin: "0 0 12px 0", fontSize: "1rem" }}>
                  Restore from Backup
                </h3>
                <div
                  style={{ display: "flex", gap: "8px", marginBottom: "12px" }}
                >
                  <input
                    type="text"
                    placeholder="Path to backup bundle JSON..."
                    value={restoreBundlePath}
                    onChange={(e) => setRestoreBundlePath(e.target.value)}
                    style={{ flex: 1, padding: "6px 10px" }}
                  />
                  <button
                    onClick={handleSelectRestoreFile}
                    style={{ padding: "6px 12px", cursor: "pointer" }}
                  >
                    Select File...
                  </button>
                  <button
                    onClick={handlePreviewRestore}
                    style={{
                      padding: "6px 14px",
                      backgroundColor: "#4b5563",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Preview
                  </button>
                </div>

                {restorePlan && (
                  <div
                    style={{
                      padding: "12px",
                      backgroundColor: "#f9fafb",
                      border: "1px solid #e5e7eb",
                      borderRadius: "6px",
                      marginBottom: "12px",
                      fontSize: "0.9rem",
                    }}
                  >
                    <h4 style={{ margin: "0 0 8px 0" }}>
                      Restore Plan Preview
                    </h4>
                    <p style={{ margin: "4px 0" }}>
                      New publications to add:{" "}
                      <strong>{restorePlan.toAdd.books}</strong>
                    </p>
                    <p style={{ margin: "4px 0" }}>
                      Publications to update:{" "}
                      <strong>{restorePlan.toUpdate.books}</strong>
                    </p>
                    <p style={{ margin: "4px 0" }}>
                      Conflicts detected:{" "}
                      <strong>{restorePlan.conflicts.length}</strong>
                    </p>

                    <div style={{ marginTop: "12px" }}>
                      <span style={{ fontWeight: 600 }}>
                        Conflict Resolution Policy:
                      </span>
                      <div
                        style={{
                          display: "flex",
                          gap: "16px",
                          marginTop: "6px",
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="radio"
                            name="policy"
                            value="keep-local"
                            checked={restorePolicy === "keep-local"}
                            onChange={() => setRestorePolicy("keep-local")}
                          />
                          <span>Keep Local</span>
                        </label>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="radio"
                            name="policy"
                            value="keep-remote"
                            checked={restorePolicy === "keep-remote"}
                            onChange={() => setRestorePolicy("keep-remote")}
                          />
                          <span>Overwrite from Backup</span>
                        </label>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="radio"
                            name="policy"
                            value="keep-both"
                            checked={restorePolicy === "keep-both"}
                            onChange={() => setRestorePolicy("keep-both")}
                          />
                          <span>Keep Both</span>
                        </label>
                      </div>
                    </div>

                    <button
                      onClick={handleApplyRestore}
                      style={{
                        marginTop: "14px",
                        padding: "8px 16px",
                        backgroundColor: "var(--color-primary, #0066cc)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Apply Restore
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: DEVICE TRANSFER */}
          {activeTab === "device" && (
            <div>
              <p
                style={{
                  margin: "0 0 16px 0",
                  fontSize: "0.9rem",
                  color: "#666",
                }}
              >
                Detect connected physical e-readers (Kindle, Kobo, PocketBook,
                or Generic USB Mass Storage) and send books directly with
                automated format verification.
              </p>

              <div
                style={{
                  border: "1px solid var(--color-border, #e0e0e0)",
                  borderRadius: "6px",
                  padding: "16px",
                  marginBottom: "16px",
                }}
              >
                <h3 style={{ margin: "0 0 12px 0", fontSize: "1rem" }}>
                  Detect Connected Device
                </h3>
                <div
                  style={{ display: "flex", gap: "8px", marginBottom: "12px" }}
                >
                  <input
                    type="text"
                    placeholder="Device mount point / drive path (e.g. /Volumes/KOBOeReader, D:\)..."
                    value={deviceMountPath}
                    onChange={(e) => setDeviceMountPath(e.target.value)}
                    style={{ flex: 1, padding: "6px 10px" }}
                  />
                  <button
                    onClick={async () => {
                      const dir = await desktopBridge.openDirectoryDialog();
                      if (dir) setDeviceMountPath(dir);
                    }}
                    style={{ padding: "6px 12px", cursor: "pointer" }}
                  >
                    Browse...
                  </button>
                  <button
                    onClick={handleDiscoverDevices}
                    style={{
                      padding: "6px 14px",
                      backgroundColor: "var(--color-primary, #0066cc)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    Scan Device
                  </button>
                </div>

                {detectedDevices.length > 0 && (
                  <div
                    style={{
                      padding: "12px",
                      backgroundColor: "#f9fafb",
                      borderRadius: "6px",
                      fontSize: "0.9rem",
                    }}
                  >
                    {detectedDevices.map((dev) => (
                      <div key={dev.id}>
                        <p style={{ margin: "2px 0", fontWeight: 600 }}>
                          {dev.name} ({dev.profile?.id ?? "generic"})
                        </p>
                        <p style={{ margin: "2px 0" }}>
                          Target directory:{" "}
                          <code>{dev.profile?.booksDirectory || "/"}</code>
                        </p>
                        <p style={{ margin: "2px 0" }}>
                          Supported formats:{" "}
                          {dev.profile?.supportedFormats.join(", ") ??
                            "epub, pdf"}
                        </p>
                        {dev.freeSpaceBytes !== undefined && (
                          <p style={{ margin: "2px 0" }}>
                            Available storage:{" "}
                            {(dev.freeSpaceBytes / (1024 * 1024)).toFixed(1)} MB
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Book selection list */}
              <div
                style={{
                  border: "1px solid var(--color-border, #e0e0e0)",
                  borderRadius: "6px",
                  padding: "16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "12px",
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "1rem" }}>
                    Select Publications to Send ({selectedBookIds.size} of{" "}
                    {libraryBooks.length})
                  </h3>
                  <button
                    onClick={handleSelectAllBooks}
                    style={{
                      padding: "4px 8px",
                      fontSize: "0.85rem",
                      cursor: "pointer",
                    }}
                  >
                    {selectedBookIds.size === libraryBooks.length
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                </div>

                <div
                  style={{
                    maxHeight: "180px",
                    overflowY: "auto",
                    border: "1px solid #e5e7eb",
                    borderRadius: "4px",
                    padding: "8px",
                    marginBottom: "14px",
                  }}
                >
                  {libraryBooks.length === 0 ? (
                    <p
                      style={{
                        margin: "8px 0",
                        color: "#666",
                        fontSize: "0.9rem",
                      }}
                    >
                      No books found in library catalog.
                    </p>
                  ) : (
                    libraryBooks.map((book) => (
                      <label
                        key={book.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "4px 0",
                          cursor: "pointer",
                          fontSize: "0.9rem",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedBookIds.has(book.id)}
                          onChange={() => {
                            const next = new Set(selectedBookIds);
                            if (next.has(book.id)) next.delete(book.id);
                            else next.add(book.id);
                            setSelectedBookIds(next);
                          }}
                        />
                        <span>
                          <strong>{book.title}</strong> [
                          {book.format.toUpperCase()}]
                          {book.creator ? ` - ${book.creator}` : ""}
                        </span>
                      </label>
                    ))
                  )}
                </div>

                <button
                  onClick={handleTransferToDevice}
                  disabled={selectedBookIds.size === 0}
                  style={{
                    padding: "8px 16px",
                    backgroundColor:
                      selectedBookIds.size > 0
                        ? "var(--color-primary, #0066cc)"
                        : "#9ca3af",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor:
                      selectedBookIds.size > 0 ? "pointer" : "not-allowed",
                  }}
                >
                  Transfer Selected ({selectedBookIds.size}) to Device
                </button>

                {transferResult && (
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "10px",
                      backgroundColor: "#f3f4f6",
                      borderRadius: "6px",
                      fontSize: "0.9rem",
                    }}
                  >
                    <p style={{ margin: "2px 0", fontWeight: 600 }}>
                      Transfer Complete
                    </p>
                    <p style={{ margin: "2px 0" }}>
                      Transferred: {transferResult.successful}, Skipped:{" "}
                      {transferResult.skipped}, Failed: {transferResult.failed}
                    </p>
                    {transferResult.errors.length > 0 && (
                      <div style={{ color: "#c81e1e", marginTop: "4px" }}>
                        {transferResult.errors.map((err, i) => (
                          <p key={i} style={{ margin: "2px 0" }}>
                            {err.path}: {err.error}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

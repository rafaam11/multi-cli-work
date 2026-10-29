export type RecoverySourceName = 'userData' | 'registry' | 'remote' | 'mods';
export type RecoverySources = Partial<Record<RecoverySourceName, string>>;
export type V1RecoverySources = RecoverySources & { userData: string; registry: string };
export interface RecoveryFileEntry { path: string; type: 'file'; size: number; sha256: string }
export interface RecoveryDirectoryEntry { path: string; type: 'directory' }
export type RecoveryEntry = RecoveryFileEntry | RecoveryDirectoryEntry;
export interface V1BackupManifest {
  schema: 1; kind: 'mcw-v1-backup'; version: '1.55.1'; createdAt: string;
  sources: V1RecoverySources; entries: RecoveryEntry[];
}
export interface RecoveryHostObservation {
  hostId: string; state: 'stopped' | 'completed' | 'running' | 'unknown'; observedAt: number;
}
export interface RollbackHostInventory { hosts: RecoveryHostObservation[]; expectedHostIds: string[] }
export interface PrepareRollbackOptions extends RollbackHostInventory {
  backupDirectory: string; destination: string; preserveV2Sources: RecoverySources;
  /** Must throw when GUI/host/CLI state is running, unobservable, or not exclusively stopped. */
  assertStopped(): Promise<void>;
}
export interface PreparedRollbackReceipt {
  schema: 1; kind: 'mcw-prepared-rollback'; version: '1.55.1'; backupDirectory: string; preparedAt: string;
  v1Entries: RecoveryEntry[]; v2Entries: RecoveryEntry[];
}
export type RecoveryInstallerPlatform = 'win32' | 'deb' | 'appimage';
export interface RecoveryAssetsManifest {
  schema: 1; version: '1.55.1'; runtimeName: string; runtimeSha256: string;
  assets: { filename: string; size: number; sha256: string }[]; installers: RecoveryInstallerPlatform[];
}
export interface ConfigJournal { schema: 1; configPath: string; beforeHash: string | null; afterHash: string }
export interface RecoveryActivation { operationId: string; retained: RecoverySources }
export interface RollbackLifecycleAdapter {
  stopNewWork(): Promise<void>;
  observeHosts(): Promise<RecoveryHostObservation[]>;
  gracefulStop(): Promise<void>;
  assertNoInstances(): Promise<void>;
  installOriginal(input: { installer: string; platform: RecoveryInstallerPlatform }): Promise<void>;
  verifyInstalledVersion(): Promise<string>;
  /** Must clear/quarantine the platform's shared v2 pending updater cache before launch. */
  clearPendingUpdaterState(): Promise<void>;
  launchV1(): Promise<void>;
}
export interface CoordinateRollbackOptions extends Omit<PrepareRollbackOptions, 'hosts' | 'assertStopped'> {
  preserveV2Sources: V1RecoverySources; targets: V1RecoverySources;
  assetsDirectory: string; platform: RecoveryInstallerPlatform;
  sharedConfigJournals?: string[]; adapter: RollbackLifecycleAdapter;
}

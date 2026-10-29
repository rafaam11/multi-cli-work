// Keep this entry point Electron-free: bootstrap must run before registry-bearing runtime imports.
export {
  ORIGINAL_INSTALLERS, getV2DataLayout, createV1Backup, verifyV1Backup,
  createModBackup,verifyModBackup,compareModBackup,
  assertRollbackHosts, prepareRollback, verifyPreparedRollback, activatePreparedRollback,
  journalSharedConfig, restoreSharedConfig, stageRecoveryAssets, verifyRecoveryAssets, coordinateRollback, installOriginalV1, compareV1WithBackup, verifyStandaloneNodeRuntime,
} from '../../../scripts/recovery/core.mjs';
export type * from '../../shared/recovery-types';

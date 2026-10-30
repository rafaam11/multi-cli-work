# v2 distribution wiring checkpoint

The stable builder keeps the original app identity, installer names and GitHub
updater metadata. It uses the same Herdr/host/recovery resources and legacy CLI
exclusions as the preview, plus a required APK whose version and digest are checked
before packaging. The release workflow refuses an unvalidated candidate, including
manual workflow dispatches. No tag or publication is performed by these changes.

The shared APK job builds and verifies the existing signing identity, then supplies
the APK to preview and stable desktop packages. It does not run Android unit/device
verification, as explicitly requested by the user. Shell source and versionCode are
unchanged; each PC supplies its own v1 or v2 web entry to the latest shell.

Initial v2 migration preserves the user's automatic-update preference. Preview
runtime suppresses automatic checks. The original-v1 rollback working copy still
disables update checks, automatic session resume and repository synchronization.

Windows checks, 2026-10-30:

- Missing/modified/stale bundled shell refusal regression passed.
- Bootstrap update-preference regression reproduced the prior forced-off setting;
  preserving true/false/default values passed. Recovery suppression regressions
  remain passing. Five focused files / 37 tests passed.
- `build:v2`, strict E2E typecheck and workflow YAML parsing passed.
- The actual stable resource configuration was packaged with a preview version,
  separate `release-v2-distribution` directory and `publish:null`. No installer was
  executed on the development PC. ASAR relative dependency check passed (6 modules).
- Packaged Electron + desktop Chrome passed in 29.2 seconds; source passed in
  30.4 seconds. After GUI exit the phone gateway served the bundled APK with the
  expected digest and still accepted explicitly controlled terminal input.
- Local package fixture used original release APK 0.3.0 (versionCode 4), SHA-256
  `230f4c65064053f05381dfd73bda4794f841397c8fc600488271e45d8e02ad72` from v1.55.1.

This is package/gateway verification, not an Android pass or stable release. The
shared CI APK build and cross-platform candidate roundtrips must run on the new
commit before final release evidence is recorded.

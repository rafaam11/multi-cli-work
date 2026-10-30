# Only the v2 candidate uses this hook. It deliberately does not include the
# legacy force-kill hook. The pinned rescue kit is extracted before the old
# installation is removed; no Electron code is needed to stage it.
!include "nsProcess.nsh"

!macro customCheckAppRunning
  Push $R0
  !ifdef BUILD_UNINSTALLER
  ${nsProcess::FindProcess} "Multi CLI Work.exe" $R0
  ${If} $R0 == 0
    ${nsProcess::Unload}
    MessageBox MB_OK|MB_ICONEXCLAMATION "Close Multi CLI Work and finish its work before installing. No process was stopped." /SD IDOK
    Abort
  ${EndIf}
  ${nsProcess::FindProcess} "Multi CLI Work Preview.exe" $R0
  ${If} $R0 == 0
    ${nsProcess::Unload}
    MessageBox MB_OK|MB_ICONEXCLAMATION "Close Multi CLI Work Preview before installing. No process was stopped." /SD IDOK
    Abort
  ${EndIf}
  ${nsProcess::Unload}
  !else
    InitPluginsDir
    SetOutPath "$PLUGINSDIR\mcw-rescue"
    File /r "${BUILD_RESOURCES_DIR}\v2-preinstall\*.*"
    nsExec::ExecToLog '"$PLUGINSDIR\mcw-rescue\v2\node\windows\node.exe" "$PLUGINSDIR\mcw-rescue\v2\host\startup-rescue.cjs" stage-install "$PLUGINSDIR\mcw-rescue" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    Pop $R0
    ${If} $R0 != 0
      MessageBox MB_OK|MB_ICONSTOP "Independent recovery could not be verified. Installation stopped before replacing the existing app." /SD IDOK
      Abort
    ${EndIf}
  !endif
  Pop $R0
!macroend

!macro customInstall
  Push $R0
  ReadEnvStr $R0 "MCW_RECOVERY_ROOT"
  ${If} $R0 == ""
    ReadEnvStr $R0 "MULTI_CLI_WORK_USER_DATA"
    ${If} $R0 == ""
      StrCpy $R0 "$APPDATA\multi-cli-work"
    ${EndIf}
    StrCpy $R0 "$R0-recovery"
  ${EndIf}
  CreateShortcut "$SMPROGRAMS\Multi CLI Work - recover v1.55.1.lnk" "$R0\return-to-v1.cmd"
  Pop $R0
!macroend

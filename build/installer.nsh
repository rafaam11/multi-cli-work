# electron-builder includes this file before its own installer.nsi, so includes and Var
# declarations belong here at global scope; only statements go inside the macro.

!include "nsProcess.nsh"

# Replaces electron-builder's default "is the app still running?" probe, which every install
# and uninstall runs before touching a file.
#
# Both of the default probe's branches ask WMI, through nsExec::Exec, which has no timeout:
#   PowerShell:  Get-CimInstance -ClassName Win32_Process | ? { $_.Path.StartsWith('$INSTDIR') }
#   fallback:    tasklist /FI ... (tasklist resolves the process list through WMI too)
# On a machine whose WMI service is wedged, both hang forever, so the installer blocks at its
# first step and never touches a file. Updating is where this hurts: electron-updater spawns
# the installer with /S and quits the app, so there is no window, no error, and no exit code
# anyone reads — the update downloads, the app restarts on the old version, and nothing says why.
#
# Measured on 1.25.0 -> 1.26.1 with WMI wedged: the spawned installer sat 18 minutes at 0.5s CPU
# with its probe still pending; `tasklist` alone never returned, while Get-Process — which reads
# the process list through the native API instead — answered in 35ms.
#
# nsProcess walks CreateToolhelp32Snapshot, so it cannot reach WMI at all. The retry shape below
# mirrors upstream's: ask politely first, force second, and — unlike proceeding regardless —
# give up loudly rather than silently overwrite a still-locked exe if even the force-kill fails.
#
# Trade-off versus upstream's WMI path: nsProcess matches by executable name only, not scoped to
# $INSTDIR (its macro interface has no path filter). Upstream's tasklist fallback has the same
# limitation; only the primary Get-CimInstance path filtered by install path. Two side-by-side
# installs of this app in different directories could close each other's running instance. Given
# perMachine:false + allowToChangeInstallationDirectory:true this is possible in principle; it is
# accepted here because the alternative — an unscoped check that can hang forever — is worse.
!macro customCheckAppRunning
  Push $R0
  Push $R1

  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    DetailPrint "$(appClosing)"
    # WM_CLOSE first so the app can persist its sessions the way an ordinary quit would.
    ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0

    StrCpy $R1 0
    loop:
      Sleep 1000
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 != 0
        Goto closed
      ${endif}
      IntOp $R1 $R1 + 1
      ${if} $R1 >= 5
        # It ignored the close request; take the files back by force rather than stall the install.
        ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        Sleep 1000
        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 == 0
          # Still alive after a forced kill (e.g. running elevated while we are not) — stop here
          # rather than risk installApplicationFiles silently overwriting a locked, running exe.
          ${nsProcess::Unload}
          MessageBox MB_OK|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDOK
          Quit
        ${endif}
        Goto closed
      ${endif}
      Goto loop
    closed:
    # Give Windows a moment to release file handles now that a process was actually closed.
    Sleep 500
  ${endif}

  ${nsProcess::Unload}

  Pop $R1
  Pop $R0
!macroend

; installer-hooks.nsi - Tauri NSIS install/uninstall hooks for ChurchAudioStream.
; Wired via tauri.conf.json -> bundle.windows.nsis.installerHooks.
;
; Hooks:
;   NSIS_HOOK_POSTINSTALL  -> runs configure-host.ps1 (PATH + firewall)
;   NSIS_HOOK_PREUNINSTALL -> runs uninstall-cleanup.ps1 (revert PATH + firewall)
;
; Both scripts are bundled as resources and live at:
;   $INSTDIR\scripts\configure-host.ps1
;   $INSTDIR\scripts\uninstall-cleanup.ps1
;   $INSTDIR\scripts\lib\cas-host-config.ps1   (dot-sourced by both)
;
; Hook scripts run with admin privileges (NSIS installer is elevated).
; Failures are non-fatal: install/uninstall completes regardless of script exit.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Configuring GStreamer PATH and firewall rule..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\configure-host.ps1" -Quiet'
  Pop $0
  ${If} $0 == 2
    DetailPrint "GStreamer not found. Run install-prerequisites.ps1 from the GitHub release before launching the app."
  ${ElseIf} $0 != 0
    DetailPrint "configure-host.ps1 exit code: $0 (non-fatal, continuing)"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Removing firewall rule and PATH entry..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\uninstall-cleanup.ps1" -Quiet'
  Pop $0
  ${If} $0 != 0
    DetailPrint "uninstall-cleanup.ps1 exit code: $0 (non-fatal, continuing)"
  ${EndIf}
!macroend

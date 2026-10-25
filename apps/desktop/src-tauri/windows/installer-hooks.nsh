; Dawnsight NSIS installer hooks (inserted into Tauri's installer.nsi).
;
; Upgrading from Lumina (<= 0.4.1): the product name changed, so the NSIS
; template treats Dawnsight as a different program. It installs beside the old
; app, and in updater (/UPDATE) mode it creates no shortcuts, which would leave
; users launching the old Lumina forever. When a per-user Lumina install is
; found, this hook:
;   1. creates the Dawnsight Start menu / desktop shortcuts even in update mode
;      (desktop only if the user had a Lumina desktop shortcut), and
;   2. runs the old uninstaller silently. Silent mode never shows the
;      "delete app data" checkbox, so %APPDATA%\lumina and the old WebView
;      profile stay in place; Dawnsight copies them forward on first start.
; MSI (WiX) installs of Lumina are not handled here.

!define LEGACY_PRODUCTNAME "Lumina"
!define LEGACY_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_PRODUCTNAME}"

; Registers: $R1 old uninstaller, $R2 its folder, $R3 had-desktop-shortcut,
; $R4 scratch / exit code. $R0 and $0 are left to the template's shortcut
; functions, which overwrite them; everything is restored on exit.
!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  ReadRegStr $R1 HKCU "${LEGACY_UNINSTKEY}" "UninstallString"
  ${If} $R1 != ""
    ; UninstallString is stored quoted: "C:\...\Lumina\uninstall.exe"
    StrCpy $R4 $R1 1
    ${If} $R4 == '"'
      StrCpy $R1 $R1 "" 1
      StrCpy $R1 $R1 -1
    ${EndIf}
    ${GetParent} $R1 $R2

    ; Check before the uninstall below removes the Lumina shortcuts.
    StrCpy $R3 "0"
    ${If} ${FileExists} "$DESKTOP\${LEGACY_PRODUCTNAME}.lnk"
      StrCpy $R3 "1"
    ${EndIf}

    ${If} $UpdateMode = 1
      ; The template's shortcut functions return early in update mode; lift it
      ; just for these calls so icons and AppUserModelId match a normal install.
      StrCpy $UpdateMode 0
      Call CreateOrUpdateStartMenuShortcut
      ${If} $R3 == "1"
        Call CreateOrUpdateDesktopShortcut
      ${EndIf}
      StrCpy $UpdateMode 1
    ${EndIf}

    ${If} ${FileExists} "$R1"
      ; `_?=` keeps the uninstaller in place so ExecWait really waits; clean
      ; up the leftover uninstaller and folder afterwards.
      ExecWait '"$R1" /S _?=$R2' $R4
      ${If} $R4 = 0
        Delete "$R1"
        RMDir "$R2"
      ${EndIf}
    ${Else}
      ; Uninstaller gone but the entry remains: drop the stale entry only.
      DeleteRegKey HKCU "${LEGACY_UNINSTKEY}"
    ${EndIf}
  ${EndIf}
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
  Pop $0
!macroend

' ======================================================================
' SAPA BPS KAB. BANGKA - SILENT LAUNCHER (ZERO CONSOLE POPUP)
' ======================================================================
Dim WshShell, fso, scriptDir
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Jalankan start_bps.bat dengan flag hidden (0 = SW_HIDE, False = async)
WshShell.Run "cmd /c """ & scriptDir & "\start_bps.bat"" hidden", 0, False

; Register My Browser as a browser candidate in Windows
; (Settings > Apps > Default apps can then select "My Browser")
!define MB_KEY "Software\Clients\StartMenuInternet\MyBrowser"
!define MB_EXE "$INSTDIR\${APP_EXECUTABLE_FILENAME}"

!macro customInstall
  WriteRegStr HKCU "${MB_KEY}" "" "My Browser"
  WriteRegStr HKCU "${MB_KEY}\DefaultIcon" "" "${MB_EXE},0"
  WriteRegStr HKCU "${MB_KEY}\shell\open\command" "" '"${MB_EXE}"'
  WriteRegStr HKCU "${MB_KEY}\Capabilities" "ApplicationName" "My Browser"
  WriteRegStr HKCU "${MB_KEY}\Capabilities" "ApplicationDescription" "Browser with vertical tabs and an AI side panel"
  WriteRegStr HKCU "${MB_KEY}\Capabilities" "ApplicationIcon" "${MB_EXE},0"
  WriteRegStr HKCU "${MB_KEY}\Capabilities\StartMenu" "StartMenuInternet" "MyBrowser"
  WriteRegStr HKCU "${MB_KEY}\Capabilities\URLAssociations" "http" "MyBrowserURL"
  WriteRegStr HKCU "${MB_KEY}\Capabilities\URLAssociations" "https" "MyBrowserURL"
  WriteRegStr HKCU "${MB_KEY}\Capabilities\FileAssociations" ".htm" "MyBrowserHTML"
  WriteRegStr HKCU "${MB_KEY}\Capabilities\FileAssociations" ".html" "MyBrowserHTML"
  WriteRegStr HKCU "${MB_KEY}\Capabilities\FileAssociations" ".pdf" "MyBrowserHTML"
  WriteRegStr HKCU "Software\RegisteredApplications" "My Browser" "${MB_KEY}\Capabilities"

  WriteRegStr HKCU "Software\Classes\MyBrowserURL" "" "My Browser URL"
  WriteRegStr HKCU "Software\Classes\MyBrowserURL" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\MyBrowserURL\DefaultIcon" "" "${MB_EXE},0"
  WriteRegStr HKCU "Software\Classes\MyBrowserURL\shell\open\command" "" '"${MB_EXE}" "%1"'
  WriteRegStr HKCU "Software\Classes\MyBrowserHTML" "" "My Browser HTML Document"
  WriteRegStr HKCU "Software\Classes\MyBrowserHTML\DefaultIcon" "" "${MB_EXE},0"
  WriteRegStr HKCU "Software\Classes\MyBrowserHTML\shell\open\command" "" '"${MB_EXE}" "%1"'

  ; Tell Windows that file/URL associations changed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "${MB_KEY}"
  DeleteRegValue HKCU "Software\RegisteredApplications" "My Browser"
  DeleteRegKey HKCU "Software\Classes\MyBrowserURL"
  DeleteRegKey HKCU "Software\Classes\MyBrowserHTML"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

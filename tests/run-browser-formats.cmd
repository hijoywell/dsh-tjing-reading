@echo off
rem Run from the repository root; every invocation is a fresh test request.
"%LOCALAPPDATA%\Tabbit\LocalAgent\bin\tabbit-cli.exe" nodejs --task "Test ebook formats" --request-id "formats-%RANDOM%-%RANDOM%" --timeout-ms 120000 < "%~dp0browser-formats-check.tabbit.js"

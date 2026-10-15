@echo off
rem Puts the "api" server program online in your Supabase project.
rem Double-click this file. The first time, a browser window asks you to sign in to Supabase.
cd /d "%~dp0.."
echo Signing in to Supabase...
call npx --yes supabase@latest login
if errorlevel 1 goto failed
echo Uploading the server program "api"...
call npx --yes supabase@latest functions deploy api --project-ref liaqgyskuhnxmlvmrnrl --no-verify-jwt --use-api
if errorlevel 1 goto failed
echo.
echo Done. Open https://liaqgyskuhnxmlvmrnrl.supabase.co/functions/v1/api/health to check it.
pause
exit /b 0
:failed
echo.
echo Something went wrong. Take a photo of this window and send it in the chat.
pause
exit /b 1

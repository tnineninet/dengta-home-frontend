@echo off
cd /d E:\chatgpt\dengta-home-frontend
call npm run build
if errorlevel 1 exit /b 1
call npx cap sync android
if errorlevel 1 exit /b 1
set JAVA_HOME=E:\chatgpt\DengTa-production-tools\jdk\jdk-21.0.11+10
set ANDROID_HOME=E:\chatgpt\DengTa-production-tools\android-sdk
set GRADLE_USER_HOME=E:\chatgpt\DengTa-production-tools\gradle-home
set PATH=%ANDROID_HOME%\platform-tools;%PATH%
cd android
call gradlew.bat :app:assembleDebug --rerun-tasks
exit /b %ERRORLEVEL%

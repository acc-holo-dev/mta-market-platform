@echo off
rem mta -- MTA Module SDK project CLI (Windows launcher).
python "%~dp0cli.py" %*
exit /b %ERRORLEVEL%
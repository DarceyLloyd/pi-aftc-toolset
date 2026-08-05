@echo off
REM publish.bat — publish the package to npmjs.com with a local token.
REM
REM The token lives in .env (repo root, one line — either the raw token or
REM NPM_TOKEN=<token>; .env is gitignored AND npmignored: never committed,
REM never shipped). The script writes it into a TEMP .npmrc used only for
REM this publish (NPM_CONFIG_USERCONFIG), so the token never lands in your
REM global/project .npmrc either. Falls back to .npm-token if no .env.
REM
REM Token: npmjs.com -> Access Tokens -> Generate New Token -> Granular
REM Access Token: publish permission for pi-aftc-toolset, "bypass 2FA"
REM enabled (package publishing access must allow bypass-2FA tokens).
REM
REM Usage: publish.bat            (publishes the version in package.json)

setlocal
set "TOKEN_FILE=%~dp0.env"
if not exist "%TOKEN_FILE%" set "TOKEN_FILE=%~dp0.npm-token"
if not exist "%TOKEN_FILE%" (
    echo ERROR: no .env ^(or .npm-token^) found at %~dp0
    echo Create .env with one line: your npm granular access token.
    exit /b 1
)
set /p LINE=<"%TOKEN_FILE%"
REM Tolerate a VAR = <token> line: take the part after '=' when present,
REM then strip ALL spaces (tokens never contain any).
echo(%LINE%| find "=" >nul && for /f "tokens=2 delims==" %%a in ("%LINE%") do set "LINE=%%a"
set "NPM_TOKEN=%LINE: =%"
if "%NPM_TOKEN%"=="" (
    echo ERROR: %TOKEN_FILE% is empty.
    exit /b 1
)

set "TMPNPMRC=%TEMP%\npm-aftc-publish-%RANDOM%%RANDOM%.npmrc"
echo //registry.npmjs.org/:_authToken=%NPM_TOKEN%>"%TMPNPMRC%"
echo registry=https://registry.npmjs.org/>>"%TMPNPMRC%"

set "NPM_CONFIG_USERCONFIG=%TMPNPMRC%"
npm publish --access public
set "RC=%ERRORLEVEL%"

del "%TMPNPMRC%" 2>nul
if "%RC%"=="0" (
    echo Published OK.
) else (
    echo Publish FAILED ^(rc=%RC%^).
)
exit /b %RC%

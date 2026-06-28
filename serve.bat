@echo off
REM Optional local-server launcher (offline). Use only if double-clicking index.html
REM doesn't run OCR in your browser. Requires Python 3 installed.
cd /d "%~dp0"
start "" "http://localhost:8000/index.html"
python -m http.server 8000

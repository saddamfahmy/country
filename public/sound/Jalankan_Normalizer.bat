@echo off
title Alat Pembersih dan Normalisasi Audio
echo ========================================================
echo       ALAT PEMBERSIH DAN NORMALISASI AUDIO OTOMATIS
echo ========================================================
echo.
echo PERINGATAN: File selain .mp3, .wav, .py, dan .bat akan dihapus!
echo Volume audio otomatis disesuaikan ke -14 LUFS (Standar Shorts).
echo.

echo Menjalankan program Python untuk memproses audio...
python normalizer.py

echo.
echo ========================================================
echo                   PROSES SELESAI
echo ========================================================
pause
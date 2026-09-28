@echo off
title Pemangkas Hening Audio Otomatis

echo ========================================================
echo        ALAT PEMOTONG AUDIO HENING BERDASARKAN POLA
echo ========================================================
echo.

set /p keyword="Masukkan kata setelah garis bawah (_) pertama: "

if "%keyword%"=="" (
    echo Kata kunci tidak boleh kosong!
    goto end
)

echo.
echo Menjalankan program Python...
python normalizer.py "%keyword%"

:end
echo.
pause
@echo off
title Penghapus File & Folder Berdasarkan Pola
echo ========================================================
echo        ALAT PENGHAPUS FILE DAN FOLDER OTOMATIS
echo ========================================================
echo.
echo PERINGATAN: Tindakan ini akan menghapus file dan folder secara permanen!
echo.

set /p keyword="Masukkan kata setelah garis bawah (_) pertama yang ingin dihapus: "

if "%keyword%"=="" (
    echo Kata kunci tidak boleh kosong!
    goto end
)

echo.
echo Menjalankan program Python untuk menghapus...
python hapus_berdasarakan_kata.py "%keyword%"

:end
echo.
pause
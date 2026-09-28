import os
import subprocess
import sys

def get_audio_duration(file_path):
    """Mengambil durasi audio dalam detik menggunakan ffprobe."""
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", 
        "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file_path
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return float(result.stdout.strip())
    except Exception:
        return None

def remove_silence_ffmpeg(file_path):
    """
    Memangkas hening di bagian akhir dengan toleransi lebih besar agar suara tidak terpotong mendadak,
    serta memberlakukan MIN_SAFE_DURATION (0.50 detik) dengan padding jika durasi kurang dari batas aman.
    """
    temp_output = file_path + ".tmp.mp3"
    
    MIN_SAFE_DURATION = 0.50  # Batas aman minimal 0.50 detik
    
    # 1. Filter FFmpeg dengan toleransi hening yang lebih longgar (-35dB & stop_duration 0.3)
    # Ini membuat pemotongan di akhir lebih halus dan tidak memotong suara di ujung kata.
    ffmpeg_cmd = [
        "ffmpeg", "-y", "-i", file_path,
        "-af", "areverse,silenceremove=start_periods=1:start_duration=0.1:start_threshold=-35dB:stop_periods=0,areverse",
        temp_output
    ]
    
    try:
        result = subprocess.run(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        
        if result.returncode == 0:
            # 2. Cek durasi setelah pemotongan
            new_duration = get_audio_duration(temp_output)
            
            # Jika hasil pemotongan di bawah MIN_SAFE_DURATION (0.50 detik), 
            # terapkan padding hening di akhir agar durasinya pas minimal 0.50 detik + buffer penutup.
            if new_duration is not None and new_duration < MIN_SAFE_DURATION:
                pad_cmd = [
                    "ffmpeg", "-y", "-i", file_path,
                    "-af", f"apad=pad_dur={MIN_SAFE_DURATION}",
                    temp_output
                ]
                subprocess.run(pad_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            
            # Timpa file asli dengan hasil akhir yang sudah diproses & dipad
            os.replace(temp_output, file_path)
            print(f"[SUKSES] Berhasil memproses dengan aman: {os.path.basename(file_path)}")
        else:
            print(f"[GAGAL] Gagal memproses {os.path.basename(file_path)}.")
            if os.path.exists(temp_output):
                os.remove(temp_output)
    except Exception as e:
        print(f"[GAGAL] Error pada {os.path.basename(file_path)}: {e}")
        if os.path.exists(temp_output):
            os.remove(temp_output)

def main():
    if len(sys.argv) < 2:
        print("Kata kunci tidak diberikan.")
        return
    
    keyword = sys.argv[1].strip()
    print(f"\nMencari file dengan pola setelah '_' ber-kata kunci: '{keyword}'...")

    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    count = 0
    for filename in os.listdir(current_dir):
        if filename.lower().endswith(('.mp3', '.wav')) and '_' in filename:
            parts = filename.split('_', 1)
            after_underscore = parts[1]
            
            if keyword.lower() in after_underscore.lower():
                file_path = os.path.join(current_dir, filename)
                print(f"Memproses: {filename}...")
                remove_silence_ffmpeg(file_path)
                count += 1

    print(f"\nSelesai! Total {count} file audio telah diperiksa & diproses.")

if __name__ == "__main__":
    main()
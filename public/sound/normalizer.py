import os
import shutil
import subprocess

# Ekstensi yang aman dan tidak akan dihapus
ALLOWED_EXTENSIONS = {'.mp3', '.wav', '.py', '.bat'}

def cleanup_directory(directory):
    for item in os.listdir(directory):
        item_path = os.path.join(directory, item)
        
        # 1. Hapus jika itu adalah folder
        if os.path.isdir(item_path):
            print(f"🗑️ Menghapus folder: {item}")
            shutil.rmtree(item_path)
            continue
            
        # 2. Hapus file jika ekstensinya tidak diizinkan
        if os.path.isfile(item_path):
            _, ext = os.path.splitext(item)
            if ext.lower() not in ALLOWED_EXTENSIONS:
                print(f"🗑️ Menghapus file: {item}")
                try:
                    os.remove(item_path)
                except Exception as e:
                    print(f"⚠️ Gagal menghapus {item}: {e}")

def process_audio_files(directory):
    for item in os.listdir(directory):
        item_path = os.path.join(directory, item)
        _, ext = os.path.splitext(item)
        
        if os.path.isfile(item_path) and ext.lower() in {'.mp3', '.wav'}:
            print(f"🔊 Menormalkan & menguatkan suara pelan pada: {item} ...")
            temp_output = os.path.join(directory, f"temp_{item}")
            
            # Kombinasi dynaudnorm (mengangkat suara pelan) & loudnorm (pembesar volume utama)
            audio_filter = "dynaudnorm=f=150:g=15:m=100:s=12,loudnorm=I=-11:LRA=7:TP=-0.5"
            
            command = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", item_path,
                "-af", audio_filter,
                temp_output
            ]
            
            try:
                subprocess.run(command, check=True)
                
                # Timpa file asli dengan file yang sudah dinormalkan
                os.replace(temp_output, item_path)
                print(f"✅ Berhasil disesuaikan: {item}")
                
            except FileNotFoundError:
                print("\n❌ ERROR FATAL: FFmpeg tidak ditemukan di komputer Anda!")
                print("   Agar audio bisa diproses, Anda WAJIB menginstal FFmpeg.")
                print("   Silakan download dan tambahkan FFmpeg ke System PATH Windows.")
                if os.path.exists(temp_output):
                    os.remove(temp_output)
                return  # Menghentikan proses jika tidak ada FFmpeg
                
            except subprocess.CalledProcessError:
                print(f"❌ Gagal memproses {item}. File audio mungkin rusak.")
                if os.path.exists(temp_output):
                    os.remove(temp_output)

if __name__ == "__main__":
    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    print("--- MEMULAI PEMBERSIHAN FOLDER ---")
    cleanup_directory(current_dir)
    
    print("\n--- MEMULAI NORMALISASI AUDIO ---")
    process_audio_files(current_dir)
    
    print("\n🎉 Semua proses selesai!")
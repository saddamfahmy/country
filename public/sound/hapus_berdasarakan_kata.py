import os
import sys
import shutil

def main():
    if len(sys.argv) < 2:
        print("Kata kunci tidak diberikan.")
        return
    
    keyword = sys.argv[1].strip()
    print(f"\nMencari file dan folder dengan pola setelah '_' ber-kata kunci: '{keyword}'...")

    current_dir = os.path.dirname(os.path.abspath(__file__))
    
    deleted_files_count = 0
    deleted_folders_count = 0

    # 1. Menghapus file yang cocok
    for filename in os.listdir(current_dir):
        if '_' in filename:
            parts = filename.split('_', 1)
            after_underscore = parts[1]
            
            # Jika kata kunci cocok dengan teks setelah '_' (case-insensitive)
            if keyword.lower() in after_underscore.lower():
                file_path = os.path.join(current_dir, filename)
                
                # Cek apakah itu folder atau file
                if os.path.isfile(file_path):
                    try:
                        os.remove(file_path)
                        print(f"[HAPUS FILE] Berhasil menghapus file: {filename}")
                        deleted_files_count += 1
                    except Exception as e:
                        print(f"[GAGAL] Gagal menghapus file {filename}: {e}")
                elif os.path.isdir(file_path):
                    try:
                        shutil.rmtree(file_path)
                        print(f"[HAPUS FOLDER] Berhasil menghapus folder: {filename}")
                        deleted_folders_count += 1
                    except Exception as e:
                        print(f"[GAGAL] Gagal menghapus folder {filename}: {e}")

    # 2. Mencari folder di dalam direktori yang namanya mengandung keyword tersebut
    for item in os.listdir(current_dir):
        item_path = os.path.join(current_dir, item)
        if os.path.isdir(item_path) and keyword.lower() in item.lower():
            try:
                shutil.rmtree(item_path)
                print(f"[HAPUS FOLDER] Berhasil menghapus folder terkait: {item}")
                deleted_folders_count += 1
            except Exception as e:
                print(f"[GAGAL] Gagal menghapus folder {item}: {e}")

    print(f"\nSelesai! Total {deleted_files_count} file dan {deleted_folders_count} folder berhasil dihapus.")

if __name__ == "__main__":
    main()
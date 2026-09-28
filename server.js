const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts'); 

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const KATA_DIR = path.join(__dirname, 'public', 'kata');
const SOUND_DIR = path.join(__dirname, 'public', 'sound');

if (!fs.existsSync(KATA_DIR)) fs.mkdirSync(KATA_DIR, { recursive: true });
if (!fs.existsSync(SOUND_DIR)) fs.mkdirSync(SOUND_DIR, { recursive: true });

function getSoundFilename(country, globalWord) {
  const safeCountry = country.replace(/[/\\?%*:|"<> ]/g, '_');
  const safeWord = globalWord.replace(/[/\\?%*:|"<> ]/g, '_');
  return `${safeCountry}_${safeWord}.mp3`;
}

// Helper untuk memetakan kode bahasa ke Voice Neural Edge TTS
function getVoiceName(langCode) {
  // Jika di JSON sudah ada nama lengkap berakhiran Neural, langsung gunakan
  if (langCode.includes('Neural')) return langCode;

  // Daftar lengkap Voice Edge TTS Default
  const defaultVoices = {
    'id-ID': 'id-ID-ArdiNeural',
    'en-US': 'en-US-AriaNeural',
    'en-GB': 'en-GB-SoniaNeural',
    'fr-FR': 'fr-FR-DeniseNeural',
    'it-IT': 'it-IT-DiegoNeural',
    'es-ES': 'es-ES-AlvaroNeural',
    'es-MX': 'es-MX-DaliaNeural',
    'pt-PT': 'pt-PT-DuarteNeural',
    'pt-BR': 'pt-BR-AntonioNeural',
    'nl-NL': 'nl-NL-ColetteNeural',
    'de-DE': 'de-DE-ConradNeural',
    'tr-TR': 'tr-TR-AhmetNeural',
    'ru-RU': 'ru-RU-DmitryNeural',
    'sv-SE': 'sv-SE-MattiasNeural',
    'nb-NO': 'nb-NO-FinnNeural',
    'da-DK': 'da-DK-JeppeNeural',
    'ms-MY': 'ms-MY-OsmanNeural',
    'ja-JP': 'ja-JP-KeitaNeural',
    'zh-CN': 'zh-CN-YunjianNeural',
    
    // -- PENAMBAHAN BAHASA BARU (ASIA & TIMUR TENGAH) --
    'zh-TW': 'zh-TW-HsiaoChenNeural', // Taiwan
    'zh-HK': 'zh-HK-HiuMaanNeural',   // Hong Kong
    'ko-KR': 'ko-KR-SunHiNeural',     // Korea
    'hi-IN': 'hi-IN-SwaraNeural',     // India (Hindi)
    'ar-SA': 'ar-SA-HamedNeural',     // Arab
    'th-TH': 'th-TH-PremwadeeNeural', // Thailand
    'vi-VN': 'vi-VN-HoaiMyNeural',    // Vietnam
    'el-GR': 'el-GR-AthinaNeural',    // Yunani
    'pl-PL': 'pl-PL-AgnieszkaNeural', // Polandia
    'uk-UA': 'uk-UA-OstapNeural'      // Ukraina
  };

  // Jika bahasa ditemukan di daftar atas, gunakan!
  if (defaultVoices[langCode]) {
    return defaultVoices[langCode];
  }

  // FALLBACK AMAN: Jika kode bahasa sama sekali tidak dikenali, 
  // jangan gabungkan string (yang bikin error), tapi paksakan pakai bahasa Inggris.
  // Server Edge TTS tidak akan error, ia hanya akan membaca teks tersebut dengan aksen Amerika.
  return 'en-US-AriaNeural'; 
}

// 1. Endpoint Get List File
app.get('/api/kata', (req, res) => {
  try {
    const files = fs.readdirSync(KATA_DIR).filter(file => file.endsWith('.json'));
    const fileList = files.map(filename => {
      const filePath = path.join(KATA_DIR, filename);
      const stats = fs.statSync(filePath);
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return {
        filename,
        title: content.global_word || filename.replace('.json', ''),
        etymology: content.etymology_origin || '',
        mtime: stats.mtime
      };
    });
    fileList.sort((a, b) => b.mtime - a.mtime);
    res.json(fileList);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca daftar file', details: err.message });
  }
});

// 2. Endpoint Get Detail JSON
app.get('/api/kata/:filename', (req, res) => {
  try {
    const filePath = path.join(KATA_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File JSON tidak ditemukan' });

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    let updated = false;

    data.route = data.route.map(item => {
      const soundName = getSoundFilename(item.country, data.global_word);
      const soundPath = path.join(SOUND_DIR, soundName);
      const exists = fs.existsSync(soundPath);

      if (item.sound_generated !== exists) {
        item.sound_generated = exists;
        updated = true;
      }
      item.sound_file = exists ? `sound/${soundName}` : null;
      return item;
    });

    if (updated) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Gagal membaca detail data', details: err.message });
  }
});

// 3. Endpoint Generate Edge TTS
// 3. Endpoint Generate Edge TTS (Versi Bersih & Tahan Banting)
// 3. Endpoint Generate Edge TTS
app.post('/api/generate-tts', async (req, res) => {
  const { filename, order } = req.body;

  try {
    const filePath = path.join(KATA_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File JSON tidak ditemukan' });

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const itemIndex = data.route.findIndex(r => r.order === order);

    if (itemIndex === -1) return res.status(400).json({ error: 'Item route tidak ditemukan' });

    const item = data.route[itemIndex];
    const soundName = getSoundFilename(item.country, data.global_word);
    const outputPath = path.join(SOUND_DIR, soundName);

    // Hapus output lama jika ternyata rusak/kosong
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      if (stats.size === 0) fs.unlinkSync(outputPath);
    }

    let success = false;
    let lastError = '';
    const maxAttempts = 2; // Batas maksimal percobaan

    // Loop Retry: Coba 1 (Asli), Coba 2 (Fallback Indonesia)
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let tempDirPath = null;

      try {
        // Tentukan teks dan bahasa berdasarkan urutan percobaan
        let textToSpeak = item.local_word;
        let langCode = item.edge_tts_lang;

        if (attempt === 2) {
          console.log(`⏳ [RETRY] Menunggu 3 detik sebelum mencoba Fallback Indonesia untuk ${item.country}...`);
          await new Promise(resolve => setTimeout(resolve, 3000)); // Jeda 3 detik
          
          textToSpeak = item.ejaan_palsu_indonesia;
          langCode = 'id-ID'; // Paksa pakai suara Indonesia
          console.log(`🔄 Menggunakan Fallback Ejaan Indonesia: "${textToSpeak}"`);
        }

        const voiceName = getVoiceName(langCode);

        // --- FOLDER Temporary Unik per Percobaan ---
        const tempDirName = `temp_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        tempDirPath = path.join(SOUND_DIR, tempDirName);
        fs.mkdirSync(tempDirPath, { recursive: true });

        // Proses Edge TTS
        const tts = new MsEdgeTTS();
        const audioFormat = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3 || 'audio-24khz-48kbitrate-mono-mp3';
        await tts.setMetadata(voiceName, audioFormat);

        // Perintahkan library menyimpan ke FOLDER temporary
        await tts.toFile(tempDirPath, textToSpeak);

        // Tangkap file 'audio.mp3' yang otomatis dibuat oleh library
        const generatedFile = path.join(tempDirPath, 'audio.mp3');

        if (fs.existsSync(generatedFile)) {
          // Pindahkan dan ubah nama file ke tujuan asli
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
          fs.renameSync(generatedFile, outputPath);
        } else {
          throw new Error("File audio.mp3 tidak berhasil dibuat oleh server TTS.");
        }

        // Update JSON
        data.route[itemIndex].sound_generated = true;
        data.route[itemIndex].sound_file = `sound/${soundName}`;
        
        // Tandai di JSON jika fallback digunakan agar log tercatat
        if (attempt === 2) {
          data.route[itemIndex].fallback_used = true;
        }

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

        // Kirim response sukses dan hentikan loop
        res.json({
          success: true,
          message: `Suara untuk ${item.country} berhasil dibuat (Attempt ${attempt})!`,
          sound_file: `sound/${soundName}`
        });
        
        success = true; 
        break; // KELUAR DARI LOOP KARENA BERHASIL

      } catch (err) {
        lastError = err.message;
        console.warn(`⚠️ TTS Error (Order ${order}, Attempt ${attempt}):`, err.message);
      } finally {
        // --- PENGAMAN ANTI-CRASH NODE.JS ---
        if (tempDirPath) {
          const folderToRemove = tempDirPath; // Kunci variabel untuk closure timeout
          setTimeout(() => {
            try {
              if (fs.existsSync(folderToRemove)) {
                const files = fs.readdirSync(folderToRemove);
                for (const file of files) {
                  fs.unlinkSync(path.join(folderToRemove, file));
                }
                fs.rmdirSync(folderToRemove);
              }
            } catch (cleanupErr) {
              // Abaikan error saat bersih-bersih
            }
          }, 5000); // Tahan 5 detik
        }
      }
    }

    // Jika sudah coba 2x dan tetap gagal
    if (!success) {
      console.error(`❌ TTS Gagal Total untuk ${item.country} walau sudah mencoba Fallback Indonesia.`);
      res.status(500).json({ error: 'Gagal memproses Edge TTS, Stream terputus', details: lastError });
    }

  } catch (globalErr) {
    console.error("Critical System Error:", globalErr);
    res.status(500).json({ error: 'Terjadi kesalahan sistem internal', details: globalErr.message });
  }
});











app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
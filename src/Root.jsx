import React from "react";
import { Composition, staticFile } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { MultiCountryMapComposition } from "./MapComposition";

// 1. IMPORT JSON LANGSUNG dari folder src/kata
import YouData from "./kata/You.json";

export const RemotionRoot = () => {
  return (
    <Composition
      id="MapAnimation-You"
      component={MultiCountryMapComposition}
      fps={60}
      width={1080}
      height={1920}
      durationInFrames={300} // Nilai sementara, akan otomatis ditimpa
      defaultProps={{
        jsonData: null,
        timelineSegments: [],
      }}
      calculateMetadata={async ({ props }) => {
        try {
          // 2. KITA TIDAK PERLU FETCH, LANGSUNG PAKAI DATA HASIL IMPORT
          const jsonData = YouData;
          const route = jsonData.route;

          const fps = 60;
          let currentFrame = 0;
          const timelineSegments = [];

          // Aturan durasi (frame)
          const INTRO_DUR = 90; 
          const MOVE_DUR = 20; 
          const OUTRO_DUR = 120; 
          const BUFFER_DUR = 3;

          // --- FASE 1: INTRO ---
          timelineSegments.push({
            type: "intro",
            start: currentFrame,
            end: currentFrame + INTRO_DUR,
            fromIdx: 0,
            toIdx: 0,
          });
          currentFrame += INTRO_DUR;

          // --- FASE 2: LOOPING RUTE ---
          for (let i = 0; i < route.length; i++) {
            let audioDurationSec = 2; // Default jika gagal baca
            try {
              // Pastikan folder 'sound' sudah di public agar ini bekerja
              audioDurationSec = await getAudioDurationInSeconds(staticFile(route[i].sound_file));
            } catch (err) {
              console.warn(`Audio tidak ditemukan untuk ${route[i].country}`, err);
            }

            const stayDur = Math.ceil(audioDurationSec * fps) + BUFFER_DUR;
            timelineSegments.push({
              type: "stay",
              start: currentFrame,
              end: currentFrame + stayDur,
              fromIdx: i,
              toIdx: i,
              audioStartFrame: currentFrame,
            });
            currentFrame += stayDur;

            if (i < route.length - 1) {
              timelineSegments.push({
                type: "move",
                start: currentFrame,
                end: currentFrame + MOVE_DUR,
                fromIdx: i,
                toIdx: i + 1,
              });
              currentFrame += MOVE_DUR;
            }
          }

          // --- FASE 3: OUTRO ---
          timelineSegments.push({
            type: "outro",
            start: currentFrame,
            end: currentFrame + OUTRO_DUR,
            fromIdx: route.length - 1,
            toIdx: route.length - 1,
          });
          currentFrame += OUTRO_DUR;

          return {
            durationInFrames: currentFrame,
            props: {
              ...props,
              jsonData,
              timelineSegments,
            },
          };
        } catch (err) {
          console.error("Gagal saat calculateMetadata:", err);
          return { durationInFrames: 300, props };
        }
      }}
    />
  );
};
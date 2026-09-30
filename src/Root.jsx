import React from "react";
import { Composition, staticFile } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { MultiCountryMapComposition } from "./MapComposition";

// 1. IMPORT JSON LANGSUNG dari folder src/kata
import YouData from "./kata/cokelat.json";

// Helper untuk menghitung jarak sudut (Great-Circle Distance) antar dua koordinat [lng, lat]
const getAngularDistance = (p1, p2) => {
  if (!p1 || !p2) return 0;
  const rad = Math.PI / 180;
  const lat1 = p1[1] * rad;
  const lat2 = p2[1] * rad;
  const dLat = (p2[1] - p1[1]) * rad;
  const dLng = (p2[0] - p1[0]) * rad;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return c; // Mengembalikan sudut dalam Radian (0 hingga PI)
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="MapAnimation-Cokelat"
      component={MultiCountryMapComposition}
      fps={60}
      width={1080}
      height={1920}
      durationInFrames={300} // Nilai sementara, akan ditimpa calculateMetadata
      defaultProps={{
        jsonData: null,
        timelineSegments: [],
      }}
      calculateMetadata={async ({ props }) => {
        try {
          const jsonData = YouData;
          const route = jsonData.route;

          const fps = 60;
          let currentFrame = 0;
          const timelineSegments = [];

          // ATURAN DURASI (FRAME)
          const INTRO_DUR = 90;
          const OUTRO_DUR = 120;
          const BUFFER_DUR = 3;

          // MAX_DUR adalah acuan durasi titik terjauh (jarak 180 derajat / setengah bumi)
          const MAX_DUR = 50; 
          const MIN_DUR = 50;  // Durasi transisi minimal untuk lokasi yang dekat

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
            let audioDurationSec = 2; // Default jika gagal
            try {
              audioDurationSec = await getAudioDurationInSeconds(
                staticFile(route[i].sound_file)
              );
            } catch (err) {
              console.warn(
                `Audio tidak ditemukan untuk ${route[i].country}`,
                err
              );
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
              // Kalkulasi Jarak Proporsional
              const p1 = route[i].coords;
              const p2 = route[i + 1].coords;
              const distAngle = getAngularDistance(p1, p2); // 0 .. PI
              const distRatio = Math.min(1, Math.max(0, distAngle / Math.PI)); // Normalized 0.0 -> 1.0

              // Durasi bergerak disesuaikan secara proporsional dengan jarak
              const moveDur = Math.round(
                MIN_DUR + (MAX_DUR - MIN_DUR) * distRatio
              );

              timelineSegments.push({
                type: "move",
                start: currentFrame,
                end: currentFrame + moveDur,
                fromIdx: i,
                toIdx: i + 1,
                distRatio: distRatio, // Dikirim ke MapComposition
              });
              currentFrame += moveDur;
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
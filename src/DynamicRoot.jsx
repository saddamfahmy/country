import React from "react";
import { Composition, staticFile } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { MultiCountryMapComposition } from "./MapComposition";

const kataFiles = require.context("../public/kata", false, /\.json$/);
const kataEntries = kataFiles.keys().map((filePath) => {
  const filename = filePath.split("/").pop().replace(/\.json$/i, "");
  const imported = kataFiles(filePath);
  const jsonData = imported.default || imported;
  const compositionName = filename
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  return {
    id: `MapAnimation-${compositionName}`,
    jsonData,
  };
});

const getAngularDistance = (p1, p2) => {
  if (!p1 || !p2) return 0;
  const rad = Math.PI / 180;
  const lat1 = p1[1] * rad;
  const lat2 = p2[1] * rad;
  const dLat = (p2[1] - p1[1]) * rad;
  const dLng = (p2[0] - p1[0]) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getTimelineSegments = async (jsonData, fps) => {
  const resolvedJsonData = {
    ...jsonData,
    route: jsonData.route?.map((entry) => ({ ...entry })),
  };
  const route = resolvedJsonData.route;
  if (!Array.isArray(route) || route.length === 0) {
    throw new Error(`JSON "${jsonData.global_word}" tidak memiliki route.`);
  }

  let currentFrame = 0;
  const timelineSegments = [];
  const INTRO_DUR = 90;
  const OUTRO_DUR = 60;
  const BUFFER_DUR = -53;
  const PRE_AUDIO_DUR = Math.round(0.5 * fps);
  const MIN_DUR = 50;
  const MAX_DUR = 50;

  timelineSegments.push({
    type: "intro",
    start: currentFrame,
    end: currentFrame + INTRO_DUR,
    fromIdx: 0,
    toIdx: 0,
  });
  currentFrame += INTRO_DUR;

  for (let i = 0; i < route.length; i++) {
    let audioDurationSec = 2;
    if (route[i].sound_file) {
      try {
        audioDurationSec = await getAudioDurationInSeconds(
          staticFile(route[i].sound_file)
        );
      } catch (err) {
        console.warn(
          `Audio tidak tersedia untuk ${route[i].country}; titik ini dirender tanpa audio.`,
          err
        );
        route[i].sound_file = null;
      }
    }

    const audioDurationFrames = Math.ceil(audioDurationSec * fps);
    const stayDur = Math.max(
      1,
      audioDurationFrames + BUFFER_DUR + PRE_AUDIO_DUR
    );
    timelineSegments.push({
      type: "stay",
      start: currentFrame,
      end: currentFrame + stayDur,
      fromIdx: i,
      toIdx: i,
      audioStartFrame: currentFrame + PRE_AUDIO_DUR,
    });
    currentFrame += stayDur;

    if (i < route.length - 1) {
      const distAngle = getAngularDistance(route[i].coords, route[i + 1].coords);
      const distRatio = Math.min(1, Math.max(0, distAngle / Math.PI));
      const moveDur = Math.round(MIN_DUR + (MAX_DUR - MIN_DUR) * distRatio);

      timelineSegments.push({
        type: "move",
        start: currentFrame,
        end: currentFrame + moveDur,
        fromIdx: i,
        toIdx: i + 1,
        distRatio,
      });
      currentFrame += moveDur;
    }
  }

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
    timelineSegments,
    jsonData: resolvedJsonData,
  };
};

export const DynamicRemotionRoot = () => (
  <>
    {kataEntries.map(({ id, jsonData }) => (
      <Composition
        key={id}
        id={id}
        component={MultiCountryMapComposition}
        fps={60}
        width={1080}
        height={1920}
        durationInFrames={300}
        defaultProps={{
          jsonData,
          timelineSegments: [],
        }}
        calculateMetadata={async ({ props }) => {
          const { durationInFrames, timelineSegments, jsonData: resolvedJsonData } =
            await getTimelineSegments(jsonData, 60);
          return {
            durationInFrames,
            props: {
              ...props,
              jsonData: resolvedJsonData,
              timelineSegments,
            },
          };
        }}
      />
    ))}
  </>
);

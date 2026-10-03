import React, { useState, useEffect, useMemo } from "react";
import {
  useCurrentFrame,
  interpolate,
  spring,
  useVideoConfig,
  delayRender,
  continueRender,
  Easing,
  staticFile,
  Img,
  Audio,
  Sequence,
  random,
} from "remotion";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from "react-simple-maps";
import { geoBounds, geoContains } from "d3-geo";
import reactionMapping from "./video/reaction-mapping.json";

const geoUrl = staticFile("topo.js");
const circleFlagAssets = require.context("./circle", false, /\.svg$/);
const circleFlagUrls = new Map(
  circleFlagAssets.keys().map((filePath) => {
    const asset = circleFlagAssets(filePath);
    return [filePath, typeof asset === "string" ? asset : asset.default];
  })
);
const BEND_FACTOR = 0.3;
const MUSIC_FILES = ["1.mp3", "2.mp3","3.mp3", "4.mp3","5.mp3", "6.mp3","7.mp3", "8.mp3"];
const MUSIC_CHOICE = null;
const MUSIC_MAX_VOLUME = 0.1;
const MUSIC_MIN_VOLUME = 0.1;
const MUSIC_FADE_SECONDS = 0.3;
const BACKGROUND_IMAGE_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const BACKGROUND_MAPPING = {
  bgchois: null,
  backgrounds: [
    {
      bg: "#3263e9",
      color: "#1e293b",
      line: "#fef08a",
    },
    {
      bg: "#0f172a",
      color: "#3f5476",
      line: "#fbbf24",
    },
    {
      bg: "#082f49",
      color: "#164e63",
      line: "#67e8f9",
    },
    {
      bg: "#f1f5f9",
      color: "#cbd5e1",
      line: "#ea580c",
    },
    {
      bg: "bg/1.jpg",
      color: "#f1eb36",
      line: "#fda4af",
    },
    {
      bg: "bg/2.jpg",
      color: "#770909",
      line: "#a7f3d0",
    },
      {
      bg: "bg/3.jpg",
      color: "#6ba5f7",
      line: "#fda4af",
    },
    {
      bg: "bg/4.jpg",
      color: "#605105",
      line: "#a7f3d0",
    },
    {
      bg: "bg/5.jpg",
      color: "#15191f",
      line: "#fda4af",
    },
    {
      bg: "bg/6.jpg",
      color: "#3f3f46",
      line: "#a7f3d0",
    },{
      bg: "bg/7.jpg",
      color: "#334155",
      line: "#fda4af",
    },
    {
      bg: "bg/8.jpg",
      color: "#39deb8",
      line: "#a7f3d0",
    },{
      bg: "bg/9.jpg",
      color: "#795128",
      line: "#fda4af",
    }
  ],
};
const mainlandCameraCountries = new Set([
  "United States",
  "France",
  "Spain",
  "Denmark",
  "Netherlands",
]);
const countryNameAliases = {
  "United States of America": "United States",
  "The Netherlands": "Netherlands",
  "Russian Federation": "Russia",
  "United Republic of Tanzania": "Tanzania",
  "Viet Nam": "Vietnam",
  "Czechia": "Czech Republic",
  "Türkiye": "Turkey",
};
const flagNameAliases = {
  "United States": ["United States of America"],
  Russia: ["Russian Federation"],
  "South Korea": ["Korea (South)"],
  "North Korea": ["Korea (North)"],
  "Czech Republic": ["Czechia"],
  Turkey: ["Turkey"],
};

const modernPalette = [
  "#10b981", "#ec4899", "#f59e0b", "#8b5cf6",
  "#14b8a6", "#f97316", "#a855f7", "#84cc16", "#06b6d4"
];

const getRandomColor = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return modernPalette[Math.abs(hash) % modernPalette.length];
};

const getLighterColor = (color) => {
  const hex = color.slice(1);
  const channels = [0, 2, 4].map((offset) =>
    parseInt(hex.slice(offset, offset + 2), 16)
  );
  return `#${channels
    .map((channel) =>
      Math.round(channel + (255 - channel) * 0.55)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
};

const normalizeCountryName = (name) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const getCircleFlagUrl = (countryName) => {
  const names = [countryName, ...(flagNameAliases[countryName] || [])];
  for (const name of names) {
    const normalizedName = normalizeCountryName(name);
    const match = circleFlagAssets.keys().find((filePath) => {
      const fileName = filePath.split("/").pop().replace(/\.svg$/i, "");
      const normalizedFileName = normalizeCountryName(fileName);
      return (
        normalizedFileName === normalizedName ||
        normalizedFileName.startsWith(`${normalizedName}`)
      );
    });
    if (match) return circleFlagUrls.get(match);
  }
  return null;
};

const getMainLandmassFeature = (geoFeature, targetCoords) => {
  if (!geoFeature || !geoFeature.geometry) return geoFeature;
  const { type, coordinates } = geoFeature.geometry;
  if (type !== "MultiPolygon") return geoFeature;

  const polygonFeatures = coordinates.map((polygonCoordinates) => ({
    type: "Feature",
    properties: geoFeature.properties,
    geometry: { type: "Polygon", coordinates: polygonCoordinates },
  }));
  const containingPolygon = polygonFeatures.find((polygon) =>
    geoContains(polygon, targetCoords)
  );
  if (containingPolygon) return containingPolygon;

  return polygonFeatures.reduce((closest, polygon) => {
    const [[minLng, minLat], [maxLng, maxLat]] = geoBounds(polygon);
    const center = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
    const distance = Math.hypot(
      center[0] - targetCoords[0],
      center[1] - targetCoords[1]
    );
    return !closest || distance < closest.distance
      ? { feature: polygon, distance }
      : closest;
  }, null)?.feature || geoFeature;
};

const getCameraBoundsAndCenter = (geoFeature, targetCoords, countryName) => {
  if (!geoFeature || !geoFeature.geometry) return null;
  const cameraFeature = mainlandCameraCountries.has(countryName)
    ? getMainLandmassFeature(geoFeature, targetCoords)
    : geoFeature;
  const [[minLng, minLat], [maxLng, maxLat]] = geoBounds(cameraFeature);
  return {
    bounds: [[minLng, minLat], [maxLng, maxLat]],
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
  };
};

// --- HELPER KALKULASI KAMERA (ZOOM & CENTERING DI VIEWPORT) ---
const getAutoCamData = (geoFeature, targetCoords, countryName) => {
  const info = getCameraBoundsAndCenter(geoFeature, targetCoords, countryName);
  if (!info) return { zoom: 5, center: targetCoords };

  const [[minLng, minLat], [maxLng, maxLat]] = info.bounds;
  const dLng = Math.abs(maxLng - minLng);
  const dLat = Math.abs(maxLat - minLat);

  const midLat = (minLat + maxLat) / 2;
  const latFactor = 1 / Math.cos((midLat * Math.PI) / 180);
  const effectiveDLat = dLat * (isNaN(latFactor) ? 1 : Math.min(latFactor, 2.5));

  const maxSpan = Math.max(dLng, effectiveDLat, 0.08);

  let calculatedZoom = 150 / (maxSpan + 1.2);
  calculatedZoom = Math.min(Math.max(calculatedZoom, 2.2), 22);

  return {
    zoom: calculatedZoom,
    center: info.center,
  };
};

// --- HELPER MATH 2D ---
const get2DControlPoint = (p0, p2, bendFactor = BEND_FACTOR) => {
  const dx = p2[0] - p0[0];
  const dy = p2[1] - p0[1];
  const midX = (p0[0] + p2[0]) / 2;
  const midY = (p0[1] + p2[1]) / 2;
  return [midX - dy * bendFactor, midY + dx * bendFactor];
};

const get2DBezierPoint = (p0, p1, p2, t) => {
  const x = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0];
  const y = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
  return [x, y];
};

const InfoOverlay = ({ data, frame, fps, reachedFrame, leaveFrame, cameraZoom }) => {
  if (!data) return null;

  const entrance = spring({
    frame: frame - reachedFrame,
    fps,
    config: { damping: 10, stiffness: 180 },
  });
  const exit = Number.isFinite(leaveFrame) && frame >= leaveFrame
    ? spring({
        frame: frame - leaveFrame,
        fps,
        config: { damping: 18, stiffness: 180 },
      })
    : 0;
  if (exit >= 0.995) return null;

  const scaleIn = interpolate(entrance, [0, 0.55, 1], [0, 1.12, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rotateIn = interpolate(
    entrance,
    [0, 0.25, 0.5, 0.75, 1],
    [-12, 8, -5, 3, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const scaleOut = 1 - interpolate(exit, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(entrance, [0, 0.15, 1], [0, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }) * (1 - exit);
  const flagUrl = getCircleFlagUrl(data.country);

  return (
    <g transform={`scale(${1 / cameraZoom})`} pointerEvents="none">
      <foreignObject x={-230} y={-220} width={460} height={145} overflow="visible">
        <div
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: "460px",
            height: "145px",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: "18px",
            boxSizing: "border-box",
            opacity,
            transform: `scale(${scaleIn * scaleOut}) rotate(${rotateIn * (1 - exit)}deg)`,
            transformOrigin: "center bottom",
          }}
        >
          {flagUrl && (
            <img
              src={flagUrl}
              alt=""
              style={{
                width: "160px",
                height: "160px",
                flex: "0 0 160px",
                borderRadius: "50%",
                border: "4px solid #fff",
                boxSizing: "border-box",
                objectFit: "cover",
                filter: "drop-shadow(0 0 16px rgba(56, 189, 248, 0.85))",
              }}
            />
          )}
          <div style={{
            flex: "1 1 auto",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "center",
            gap: "20px",
            textAlign: "left",
          }}>
            <div style={{
              maxWidth: "100%",
              color: "#fef08a",
              fontSize: "42px",
              fontWeight: 800,
              lineHeight: 1.05,
              overflowWrap: "anywhere",
              WebkitTextStroke: "2px #0f172a",
              paintOrder: "stroke fill",
              textShadow: "0 2px 10px #020617",
            }}>
              {data.local_word}
            </div>
            <div style={{
              maxWidth: "100%",
              color: "#e0f2fe",
              fontSize: "28px",
              fontWeight: 700,
              lineHeight: 1.1,
              overflowWrap: "anywhere",
              WebkitTextStroke: "1.2px #0f172a",
              paintOrder: "stroke fill",
              textShadow: "0 2px 9px #020617",
            }}>
              {data.ejaan_umum_ipa}
            </div>
          </div>
        </div>
      </foreignObject>
    </g>
  );
};

const StoryTitle = ({ globalWord }) => (
  <div style={{
    position: "absolute",
    top: "5.5%",
    left: 0,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    zIndex: 10,
    pointerEvents: "none",
  }}>
    <div style={{
        maxWidth: "calc(100% - 64px)",
        boxSizing: "border-box",
        background: "rgba(230, 236, 250, 0.94)",
        border: "2px solid rgba(56, 189, 248, 0.8)",
        borderRadius: "12px",
        padding: "12px 24px",
        color: "#0a0a0a",
        fontSize: "min(68px, 5.4vw)",
        fontWeight: 800,
        letterSpacing: "1px",
        lineHeight: 1.1,
        textShadow: "0 2px 5px #020617",
        boxShadow: "0 4px 18px rgba(2, 6, 23, 0.55)",
      }}>
      Finally, you discover how
    </div>
    <div style={{
        maxWidth: "calc(100% - 64px)",
        boxSizing: "border-box",
        background: "rgba(241, 241, 242, 0.94)",
        border: "2px solid rgba(56, 189, 248, 0.8)",
        borderRadius: "12px",
        padding: "12px 24px",
        whiteSpace: "nowrap",
        color: "#141414",
        fontSize: "min(68px, 5.4vw)",
        fontWeight: 800,
        letterSpacing: "1px",
        lineHeight: 1.1,
        textShadow: "0 2px 5px #020617",
        boxShadow: "0 4px 18px rgba(2, 6, 23, 0.55)",
      }}>
       the word '{globalWord}' evolves
    </div>
  </div>
);

const getReactionRange = (similarity) => {
  if (typeof similarity !== "number" || !Number.isFinite(similarity)) {
    return null;
  }
  return reactionMapping.similarityRanges.find(
    (range) => similarity >= range.min && similarity <= range.max
  );
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getBouncedReactionFrame = (elapsedSourceFrames, startFrame, endFrame) => {
  const rangeLength = endFrame - startFrame;
  if (rangeLength <= 0) return startFrame;

  const cycleLength = rangeLength * 2;
  const cyclePosition = elapsedSourceFrames % cycleLength;
  return cyclePosition <= rangeLength
    ? startFrame + cyclePosition
    : endFrame - (cyclePosition - rangeLength);
};

const getReactionFrameInPhase = (frame, phase, fps) => {
  const sourceFps = reactionMapping.sourceFps;
  const transitionFrames = reactionMapping.transitionSeconds * fps;

  if (phase.type === "intro") {
    const introEndFrame = reactionMapping.intro.endSecond * sourceFps;
    return Math.min(
      (frame / fps) * sourceFps,
      introEndFrame - 1
    );
  }

  const elapsedFrames = Math.max(0, frame - phase.start);
  const targetStartFrame = phase.range.startSecond * sourceFps;
  const targetEndFrame = phase.range.endSecond * sourceFps - 1;
  if (elapsedFrames < transitionFrames) {
    const progress = elapsedFrames / transitionFrames;
    return phase.fromFrame + (targetStartFrame - phase.fromFrame) * progress;
  }

  const elapsedSourceFrames =
    ((elapsedFrames - transitionFrames) / fps) * sourceFps;
  return getBouncedReactionFrame(
    elapsedSourceFrames,
    targetStartFrame,
    targetEndFrame
  );
};

const getReactionFrame = (frame, timelineSegments, route, fps) => {
  const phaseEvents = timelineSegments
    .filter(
      (segment) =>
        segment.type === "stay" &&
        segment.start <= frame &&
        route[segment.fromIdx]?.sound_file
    )
    .map((segment) => ({
      start: segment.audioStartFrame ?? segment.start,
      range: getReactionRange(route[segment.fromIdx].similarity_percentage),
    }))
    .filter((event) => event.range)
    .sort((a, b) => a.start - b.start);

  let phase = { type: "intro" };
  for (const event of phaseEvents) {
    const fromFrame = getReactionFrameInPhase(event.start, phase, fps);
    phase = {
      type: "trigger",
      start: event.start,
      fromFrame,
      range: event.range,
    };
  }

  const outro = timelineSegments.find(
    (segment) => segment.type === "outro" && frame >= segment.start
  );
  if (outro) {
    const returnStartFrame = getReactionFrameInPhase(outro.start, phase, fps);
    const progress = clamp(
      (frame - outro.start) / (reactionMapping.outroSeconds * fps),
      0,
      1
    );
    return returnStartFrame * (1 - progress);
  }

  return getReactionFrameInPhase(frame, phase, fps);
};

const GreenScreenVideo = ({ frame, timelineSegments, route, fps }) => {
  const reactionFrame = Math.floor(
    clamp(
      getReactionFrame(frame, timelineSegments, route, fps),
      0,
      reactionMapping.durationSeconds * reactionMapping.sourceFps - 1
    )
  );
  const frameFile = `reaction-${String(reactionFrame).padStart(3, "0")}.webp`;

  return (
    <div style={{
      position: "absolute",
      bottom: "40px",
      right: "40px",
      width: "480px",
      height: "480px",
      borderRadius: "16px",
      overflow: "hidden",
      border: "none",
      zIndex: 20,
    }}>
      <Img
        src={staticFile(`reaction-frames/${frameFile}`)}
        alt=""
        maxRetries={0}
        onImageError={(error) => {
          console.warn(`Reaction frame ${frameFile} is unavailable; skipping that frame.`, error);
        }}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
         
        }}
      />
    </div>
  );
};

export const MultiCountryMapComposition = ({ jsonData, timelineSegments }) => {
  if (!jsonData || !jsonData.route || !timelineSegments || timelineSegments.length === 0) {
    return null; 
  }
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const route = jsonData.route;

const [musicIndex] = useState(() =>
  MUSIC_CHOICE == null
    ? Math.floor(random("musik-" + jsonData.global_word) * MUSIC_FILES.length)
    : MUSIC_CHOICE - 1
);
  const musicFile = MUSIC_FILES[musicIndex];
  if (!musicFile) {
    throw new Error(`Invalid MUSIC_CHOICE value "${MUSIC_CHOICE}".`);
  }
const [backgroundIndex] = useState(() =>
    BACKGROUND_MAPPING.bgchois == null
      ? Math.floor(random("katar" + jsonData.global_word) * BACKGROUND_MAPPING.backgrounds.length)
      : BACKGROUND_MAPPING.bgchois - 1
  );
  const backgroundChoice = BACKGROUND_MAPPING.backgrounds[backgroundIndex];
  if (!backgroundChoice) {
    throw new Error(
      `Invalid bgchois value "${BACKGROUND_MAPPING.bgchois}" in BACKGROUND_MAPPING.`
    );
  }
  const backgroundIsImage = BACKGROUND_IMAGE_PATTERN.test(backgroundChoice.bg);
  const backgroundImage = backgroundIsImage
    ? `url("${staticFile(backgroundChoice.bg)}")`
    : "none";
  const backgroundColor = backgroundIsImage
    ? "#0f172a"
    : backgroundChoice.bg;

  const [handle] = useState(() => delayRender("Loading Map TopoJSON..."));
  const [autoCamMap, setAutoCamMap] = useState({});

  useEffect(() => {
    fetch(geoUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Map data request failed: ${response.status}`);
        }
        continueRender(handle);
      })
      .catch((error) => {
        console.warn("Map data is unavailable; rendering without map geometry.", error);
        continueRender(handle);
      });
  }, [handle]);

  const activeSegment = useMemo(() => {
    return timelineSegments.find(s => frame >= s.start && frame < s.end) || timelineSegments[timelineSegments.length - 1];
  }, [frame, timelineSegments]);

  const getReachedFrame = (idx) => {
    const staySeg = timelineSegments.find(s => s.type === "stay" && s.fromIdx === idx);
    return staySeg ? staySeg.start : Infinity;
  };
  const isIntroPreview = activeSegment.type === "intro";
  const markerFrame = isIntroPreview
    ? timelineSegments[timelineSegments.length - 1].end - 1
    : frame;

  const getTargetZoom = (idx) => {
    const countryData = route[idx];
    if (!countryData) return 5;
    if (countryData.zoom !== undefined) return countryData.zoom;
    if (autoCamMap[countryData.country]) {
      return autoCamMap[countryData.country].zoom;
    }
    return 5;
  };

  const getTargetCenter = (idx) => {
    const countryData = route[idx];
    if (!countryData) return [0, 0];
    if (autoCamMap[countryData.country]) {
      return autoCamMap[countryData.country].center;
    }
    return countryData.coords;
  };
  const getRouteIndex = (geoName) => {
    if (typeof geoName !== "string") return -1;
    const canonicalName = countryNameAliases[geoName] || geoName;
    const normalizedName = normalizeCountryName(canonicalName);
    return route.findIndex(
      (waypoint) => normalizeCountryName(waypoint.country) === normalizedName
    );
  };

  // BASE_ZOOM diperkecil menjadi 0.7 agar tampilan zoom out/peta awal & akhir lebih luas
  const BASE_ZOOM = 3;
  const initialCameraCenter = [...route[0].coords];
  const initialCameraZoom = BASE_ZOOM;
  let cameraCenter = initialCameraCenter;
  let cameraZoom = initialCameraZoom;
  let legProgress = 0;

  if (activeSegment.type === "intro") {
    const progress = interpolate(
      frame - activeSegment.start,
      [0, Math.max(1, activeSegment.end - activeSegment.start - 1)],
      [0, 1]
    );
    const startCenter = initialCameraCenter;
    const endCenter = getTargetCenter(0);
    
    cameraCenter = [
      interpolate(progress, [0, 1], [startCenter[0], endCenter[0]]),
      interpolate(progress, [0, 1], [startCenter[1], endCenter[1]]),
    ];
    cameraZoom = interpolate(Easing.in(Easing.poly(3))(progress), [0, 1], [initialCameraZoom, getTargetZoom(0)]);
  } 
  else if (activeSegment.type === "stay") {
    const stayProgress = interpolate(
      frame - activeSegment.start,
      [0, Math.max(1, activeSegment.end - activeSegment.start - 1)],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    const motion = Math.sin(Math.PI * stayProgress) ** 2;
    const motionPattern = [
      { longitude: 0.55, latitude: 0, zoom: 0.4 },
      { longitude: -0.55, latitude: 0, zoom: 0.3 },
      { longitude: 0, latitude: 0.4, zoom: 0.5 },
      { longitude: 0, latitude: -0.4, zoom: 0.35 },
    ][activeSegment.fromIdx % 4];
    const centerCoord = getTargetCenter(activeSegment.fromIdx);
    cameraCenter = [
      centerCoord[0] + motionPattern.longitude * motion,
      centerCoord[1] + motionPattern.latitude * motion,
    ];
    cameraZoom = getTargetZoom(activeSegment.fromIdx) + motionPattern.zoom * motion;
  } 
  else if (activeSegment.type === "move") {
    const progress = interpolate(
      frame - activeSegment.start,
      [0, Math.max(1, activeSegment.end - activeSegment.start - 1)],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
    legProgress = Easing.inOut(Easing.quad)(progress);

    const p0 = getTargetCenter(activeSegment.fromIdx);
    const p2 = getTargetCenter(activeSegment.toIdx);
    const cp = get2DControlPoint(p0, p2, BEND_FACTOR);
    
    cameraCenter = get2DBezierPoint(p0, cp, p2, legProgress);

    cameraZoom = interpolate(
      legProgress,
      [0, 0.5, 1],
      [getTargetZoom(activeSegment.fromIdx), BASE_ZOOM * 1.5, getTargetZoom(activeSegment.toIdx)],
      { 
        extrapolateLeft: "clamp", 
        extrapolateRight: "clamp",
        easing: Easing.bezier(0.25, 0.1, 0.25, 1)
      }
    );
  } 
  else if (activeSegment.type === "outro") {
    const startCenter = getTargetCenter(activeSegment.fromIdx);
    const startZoom = getTargetZoom(activeSegment.fromIdx);
    const endCenter = initialCameraCenter;
    const progress = Math.min(
      1,
      (frame - activeSegment.start) / Math.max(1, activeSegment.end - activeSegment.start - 1)
    );
    
    cameraCenter = [
      interpolate(progress, [0, 1], [startCenter[0], endCenter[0]]),
      interpolate(progress, [0, 1], [startCenter[1], endCenter[1]]),
    ];
    cameraZoom = interpolate(
      Easing.out(Easing.poly(3))(progress),
      [0, 1],
      [startZoom, initialCameraZoom]
    );
  }

  const renderableRoutes = useMemo(() => {
    const routes = [];
    for (let l = 0; l < route.length - 1; l++) {
      const moveSeg = timelineSegments.find(s => s.type === "move" && s.fromIdx === l);
      if (!moveSeg) continue;

      let progressLimit = 0;
      if (isIntroPreview || frame >= moveSeg.end) progressLimit = 1;
      else if (frame >= moveSeg.start && frame < moveSeg.end) {
        progressLimit = Easing.inOut(Easing.quad)(
          interpolate(
            frame - moveSeg.start,
            [0, Math.max(1, moveSeg.end - moveSeg.start - 1)],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          )
        );
      }

      if (progressLimit > 0) {
        const numSteps = 240;
        const p0 = route[l].coords;
        const p2 = route[l+1].coords;
        const cp = get2DControlPoint(p0, p2, BEND_FACTOR);
        const coordinates = [];

        for (let i = 0; i <= numSteps; i++) {
          const t = (i / numSteps) * progressLimit;
          coordinates.push(get2DBezierPoint(p0, cp, p2, t));
        }
        routes.push({ key: `leg-${l}`, coordinates });
      }
    }
    return routes;
  }, [route, timelineSegments, frame, isIntroPreview]);

  const renderAudio = () => {
    const speechSegments = timelineSegments.filter(
      (segment) =>
        segment.type === "stay" && route[segment.fromIdx]?.sound_file
    );
    const musicVolume = (audioFrame) => {
      const fadeFrames = Math.max(1, Math.round(MUSIC_FADE_SECONDS * fps));
      let volume = MUSIC_MAX_VOLUME;

      for (const segment of speechSegments) {
        const start = segment.audioStartFrame ?? segment.start;
        const end = segment.end;
        let segmentVolume = MUSIC_MAX_VOLUME;

        if (audioFrame < start && audioFrame >= start - fadeFrames) {
          const progress = (audioFrame - (start - fadeFrames)) / fadeFrames;
          segmentVolume =
            MUSIC_MAX_VOLUME +
            (MUSIC_MIN_VOLUME - MUSIC_MAX_VOLUME) * progress;
        } else if (audioFrame >= start && audioFrame < end) {
          segmentVolume = MUSIC_MIN_VOLUME;
        } else if (audioFrame >= end && audioFrame < end + fadeFrames) {
          const progress = (audioFrame - end) / fadeFrames;
          segmentVolume =
            MUSIC_MIN_VOLUME +
            (MUSIC_MAX_VOLUME - MUSIC_MIN_VOLUME) * progress;
        }

        volume = Math.min(volume, segmentVolume);
      }

      return volume;
    };
    const backgroundMusic = (
      <Audio
        key="background-music"
        src={staticFile(`musik/${musicFile}`)}
        loop
        volume={musicVolume}
      />
    );

    const introSegment = timelineSegments.find((segment) => segment.type === "intro");
    const introAudio = introSegment ? (
      <Sequence
        key="intro-zoom-audio"
        from={introSegment.start}
        durationInFrames={introSegment.end - introSegment.start}
      >
        <Audio src={staticFile("sound efek/zoom-in.wav")} />
      </Sequence>
    ) : null;


    // --- 1. TAMBAHKAN KODE EFEK SUARA GARIS MELENGKUNG DI SINI ---
    const Audiomelengkung = timelineSegments
      .filter((segment) => segment.type === "move")
      .map((segment) => (
        <Sequence
          key={`garis-melengkung-audio-${segment.fromIdx}`}
          from={segment.start}
          durationInFrames={segment.end - segment.start}
        >
          <Audio src={staticFile("sound efek/move.wav")} />
        </Sequence>
      ));

    const arrivalAudio = timelineSegments
      .filter((segment) => segment.type === "stay")
      .map((segment) => (
        <Sequence
          key={`arrival-click-${segment.fromIdx}`}
          from={segment.start}
          durationInFrames={segment.end - segment.start}
        >
          <Audio src={staticFile("sound efek/click.wav")} />
        </Sequence>
      ));

    const stayAudio = timelineSegments.filter(s => s.type === "stay").map((seg, idx) => {
      const audioUrl = route[idx].sound_file;
      if (!audioUrl) return null;
      return (
        <Sequence
          key={`audio-${idx}`}
          from={seg.audioStartFrame}
          durationInFrames={seg.end - seg.audioStartFrame}
        >
          <Audio src={staticFile(audioUrl)} />
        </Sequence>
      );
    });

    const outroSegment = timelineSegments.find((segment) => segment.type === "outro");
    const outroAudio = outroSegment ? (
      <Sequence
        key="outro-zoom-audio"
        from={outroSegment.start}
        durationInFrames={outroSegment.end - outroSegment.start}
      >
        <Audio src={staticFile("sound efek/zoom-out.mp3")} />
      </Sequence>
    ) : null;

    return [backgroundMusic, introAudio, ...Audiomelengkung,...arrivalAudio, ...stayAudio, outroAudio];
  };

  

  return (
    <div style={{ width: "100%", height: "100%", backgroundColor, backgroundImage, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat", display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden", fontFamily: "system-ui, sans-serif", position: "relative" }}>
      
      <StoryTitle globalWord={jsonData.global_word} />

      <GreenScreenVideo
        frame={frame}
        timelineSegments={timelineSegments}
        route={route}
        fps={fps}
      />

      {renderAudio()}

      <div style={{ width: "100%", height: "100%" }}>
        <ComposableMap
          projection="geoMercator"
          width={width}
          height={height}
          style={{
            width: "100%",
            height: "100%",
            backgroundColor,
            backgroundImage,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        >
          <ZoomableGroup 
            center={cameraCenter} 
            zoom={cameraZoom}
            minZoom={0.5}
            maxZoom={30}
          >
            <defs>
              <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur1" />
                <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur2" />
                <feMerge>
                  <feMergeNode in="blur2" />
                  <feMergeNode in="blur1" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="countryNeonGlow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="softGlow" />
                <feGaussianBlur in="SourceGraphic" stdDeviation="11" result="wideGlow" />
                <feMerge>
                  <feMergeNode in="wideGlow" />
                  <feMergeNode in="softGlow" />
                </feMerge>
              </filter>
              <filter id="countryCoreGlow" x="-100%" y="-100%" width="300%" height="300%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="softCore" />
                <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="wideCore" />
                <feMerge>
                  <feMergeNode in="wideCore" />
                  <feMergeNode in="softCore" />
                </feMerge>
              </filter>
              <filter id="routeNeonGlow" x="-300%" y="-300%" width="700%" height="700%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="softGlow" />
                <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="wideGlow" />
                <feMerge>
                  <feMergeNode in="wideGlow" />
                  <feMergeNode in="softGlow" />
                </feMerge>
              </filter>
            </defs>

            <Geographies geography={geoUrl}>
              {({ geographies, path }) => {
                if (geographies && geographies.length > 0 && Object.keys(autoCamMap).length === 0) {
                  const calculatedMap = {};
                  route.forEach((target) => {
                    const targetIndex = route.indexOf(target);
                    const matchGeo = geographies.find(
                      (g) => getRouteIndex(g.properties.name) === targetIndex
                    );
                    if (matchGeo) {
                      calculatedMap[target.country] = getAutoCamData(
                        matchGeo,
                        target.coords,
                        target.country
                      );
                    }
                  });
                  if (Object.keys(calculatedMap).length > 0) {
                    setAutoCamMap(calculatedMap);
                  }
                }

                const sortedGeographies = [...geographies].sort((a, b) => {
                  const indexA = getRouteIndex(a.properties.name);
                  const indexB = getRouteIndex(b.properties.name);
                  const isVisitedA = indexA !== -1 && (isIntroPreview || frame >= getReachedFrame(indexA));
                  const isVisitedB = indexB !== -1 && (isIntroPreview || frame >= getReachedFrame(indexB));
                  return (isVisitedA ? indexA + 1 : 0) - (isVisitedB ? indexB + 1 : 0);
                });

                return (
                  <>
                    {sortedGeographies.map((geo) => {
                  const countryKey = geo.properties.name || geo.rsmKey;
                  const wpIndex = getRouteIndex(countryKey);
                  const waypoint = wpIndex !== -1 ? route[wpIndex] : null;
                  const isRouteCountry = waypoint !== null;
                  const countryColor = getRandomColor(waypoint?.country || countryKey);
                  const reachedFrame = wpIndex !== -1 ? getReachedFrame(wpIndex) : Infinity;
                  const isVisited =
                    isRouteCountry && (isIntroPreview || frame >= reachedFrame);
                  const moveSegment = timelineSegments.find(
                    (segment) => segment.type === "move" && segment.fromIdx === wpIndex
                  );
                  const outroSegment = timelineSegments.find(
                    (segment) => segment.type === "outro" && segment.fromIdx === wpIndex
                  );
                  const leaveSegment = moveSegment || outroSegment;
                  let glowOpacity = 0;
                  if (!isIntroPreview && isVisited && isRouteCountry) {
                    const fadeIn = interpolate(
                      frame - reachedFrame,
                      [0, 12],
                      [0, 1],
                      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                    );
                    const fadeOut = leaveSegment
                      ? interpolate(
                          frame - leaveSegment.start,
                          [0, 18],
                          [1, 0],
                          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                        )
                      : 1;
                    glowOpacity = Math.min(fadeIn, fadeOut);
                  }
                  const neonPulse = 0.84 + 0.16 * Math.sin(frame * 0.18);
                  const neonOpacity = glowOpacity * neonPulse;

                  return (
                    <React.Fragment key={geo.rsmKey}>
                      <Geography
                        geography={geo}
                        fill={isVisited ? countryColor : backgroundChoice.color}
                        stroke={isVisited ? countryColor : backgroundChoice.color}
                        strokeWidth={isVisited ? 0.25 : 0.1}
                        style={{
                          default: {
                            outline: "none",
                            transition: "fill 0.5s ease"
                          },
                          hover: { outline: "none" },
                          pressed: { outline: "none" },
                        }}
                      />
                      {neonOpacity > 0 && (
                        <Geography
                          geography={geo}
                          fill={getLighterColor(countryColor)}
                          fillOpacity={neonOpacity * 0.16}
                          stroke={getLighterColor(countryColor)}
                          strokeWidth={2.2}
                          strokeOpacity={neonOpacity * 0.8}
                          style={{
                            default: {
                              outline: "none",
                              filter: "url(#countryNeonGlow)",
                              pointerEvents: "none",
                            },
                            hover: { outline: "none" },
                            pressed: { outline: "none" },
                          }}
                        />
                      )}
                      {neonOpacity > 0 && (
                        <Geography
                          geography={geo}
                          fill="none"
                          stroke="#d9f8ff"
                          strokeWidth={1.1}
                          strokeOpacity={neonOpacity * 0.38}
                          style={{
                            default: {
                              outline: "none",
                              filter: "url(#countryCoreGlow)",
                              pointerEvents: "none",
                            },
                            hover: { outline: "none" },
                            pressed: { outline: "none" },
                          }}
                        />
                      )}
                    </React.Fragment>
                  );
                    })}
                    {renderableRoutes.map((routeLine) => {
                      const d = path({
                        type: "LineString",
                        coordinates: routeLine.coordinates,
                      });
                      const haloWidth = 8 / (cameraZoom / 2);
                      const coreWidth = 2 / (cameraZoom / 2);

                      return (
                        <g
                          key={routeLine.key}
                          fill="none"
                          stroke={backgroundChoice.line}
                        >
                          <path
                            d={d}
                            strokeWidth={haloWidth}
                            strokeOpacity={0.72}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ filter: "url(#routeNeonGlow)" }}
                          />
                          <path
                            d={d}
                            strokeWidth={coreWidth}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </g>
                      );
                    })}
                  </>
                );
              }}
            </Geographies>

            {/* --- UPDATE: Marker Titik Negara & Animasi Tertanam --- */}
            {route.map((wp, index) => {
              const reachedFrame = getReachedFrame(index);
              const isReached = markerFrame >= reachedFrame;
              if (!isReached) return null;

              // Cari frame saat titik utama (kamera) mulai bergerak meninggalkan negara ini
              const moveSeg = timelineSegments.find((s) => s.type === "move" && s.fromIdx === index);
              const leaveFrame = moveSeg ? moveSeg.start : Infinity;
              const isLeaving = markerFrame >= leaveFrame;
              const isCurrentInfo =
                !isIntroPreview &&
                activeSegment.fromIdx === index &&
                ["stay", "move", "outro"].includes(activeSegment.type);
              const outroSeg = timelineSegments.find(
                (segment) => segment.type === "outro" && segment.fromIdx === index
              );
              const infoLeaveFrame = moveSeg
                ? moveSeg.start
                : outroSeg
                  ? outroSeg.start
                  : Infinity;

              // 1. Skala membesar (Scale In) saat titik tiba
              const scaleIn = Math.max(0, spring({ frame: markerFrame - reachedFrame, fps, config: { damping: 12 } }));
              
              // 2. Skala mengecil (Scale Out) perlahan agar terlihat tertanam kembali di map
              const scaleOut = isLeaving 
                ? Math.max(0, spring({ frame: markerFrame - leaveFrame, fps, config: { damping: 12, stiffness: 90 } }))
                : 0;

              // Hitung kepersisian base skala dengan mereduksi scaleIn menggunakan scaleOut
              const baseScale = scaleIn * (1 - scaleOut);
              
              // Hitung inverse zoom presisi agar tidak bergoyang/jitter saat kamera zoom out
              const invScale = 1 / (cameraZoom * 0.2);
              
              // Terapkan kalkulasi akhir lingkungan/scale
              const finalScale = baseScale * invScale;
              // Optimasi: Jika marker sudah 100% tertanam & lenyap (skala <= 0.001), berhenti merender marker ini
              if (isLeaving && finalScale <= 0.001) return null;

              return (
                <Marker key={wp.country} coordinates={wp.coords}>
                  <g transform={`scale(${finalScale})`}>
                    <circle
                      r={index === 0 ? 1.5 : 2}
                      fill={index === 0 ? "#f43f5e" : "#fef08a"}
                      stroke="#0f172a"
                      strokeWidth={0.5}
                      style={index !== 0 ? { filter: "url(#neonGlow)" } : {}}
                    />
                  <text
                    textAnchor="middle"
                    y={-4}
                    style={{
                      fill: "#ffffff",
                      fontSize: "9px",
                      fontWeight: "bold",
                      textShadow: "0px 0px 10px rgba(0,0,0,0.8)",
                      // Teks perlahan memudar (fade-out) bersamaan dengan skala yang mengecil
                      opacity: Math.max(0, 1 - scaleOut), 
                      
                      // --- TAMBAHAN UNTUK STROKE TEBAL ---
                      stroke: "#000000",       // Warna garis pinggir (misal: hitam)
                      strokeWidth: "2.5px",    // Ketebalan garis pinggir (atur sesuai selera, misal 2px - 3px)
                      strokeLinejoin: "round", // Membuat sudut garis melengkung agar rapi
                      paintOrder: "stroke fill", // Memastikan stroke ada di belakang warna utama teks
                    }}
                  >
                    {wp.country}
                  </text>
                  </g>
                  {isCurrentInfo && (
                    <InfoOverlay
                      data={wp}
                      frame={frame}
                      fps={fps}
                      reachedFrame={reachedFrame}
                      leaveFrame={infoLeaveFrame}
                      cameraZoom={cameraZoom}
                    />
                  )}
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>
      </div>
    </div>
  );
};
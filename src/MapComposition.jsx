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
  Audio,
  Sequence,
} from "remotion";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  Sphere,
  Line,
} from "react-simple-maps";

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
const BEND_FACTOR = 0.60;

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

const unwrapLng = (fromLng, toLng) => {
  let diff = toLng - fromLng;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return fromLng + diff;
};

const getControlPoint = (p0, p2, bendFactor = BEND_FACTOR) => {
  const p2LngUnwrapped = unwrapLng(p0[0], p2[0]);
  const dx = p2LngUnwrapped - p0[0];
  const dy = p2[1] - p0[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  const midX = (p0[0] + p2LngUnwrapped) / 2;
  const midY = (p0[1] + p2[1]) / 2;
  const normalX = -dy / (dist || 1);
  const normalY = dx / (dist || 1);
  return [midX + normalX * dist * bendFactor, midY + normalY * dist * bendFactor];
};

const getQuadraticBezierPoint = (p0, p1, p2, t) => {
  const p2LngUnwrapped = unwrapLng(p0[0], p2[0]);
  let x = (1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2LngUnwrapped;
  const y = (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1];
  x = ((x + 180) % 360 + 360) % 360 - 180;
  return [x, y];
};

// Komponen Informasi yang muncul di tengah saat audio diputar
const InfoOverlay = ({ data, segment, frame, fps }) => {
  if (!data) return null;
  
  const progress = frame - segment.start;
  const scaleIn = spring({ frame: progress, fps, config: { damping: 12 } });
  
  // Hilang dengan perlahan sebelum pindah
  const opacityOut = interpolate(segment.end - frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{
      position: "absolute",
      top: "15%",
      left: 0,
      width: "100%",
      display: "flex",
      justifyContent: "center",
      transform: `scale(${scaleIn})`,
      opacity: opacityOut,
      zIndex: 10,
    }}>
      <div style={{
        background: "rgba(15, 23, 42, 0.85)",
        border: "2px solid #38bdf8",
        padding: "30px 50px",
        borderRadius: "20px",
        textAlign: "center",
        boxShadow: "0px 0px 30px rgba(56, 189, 248, 0.4)",
        backdropFilter: "blur(10px)",
      }}>
        <h2 style={{ margin: 0, color: "#94a3b8", fontSize: "28px", textTransform: "uppercase", letterSpacing: "2px" }}>
          {data.country}
        </h2>
        <h1 style={{ margin: "10px 0", color: "#fef08a", fontSize: "75px", fontWeight: "bold" }}>
          {data.local_word}
        </h1>
        <p style={{ margin: 0, color: "#38bdf8", fontSize: "35px", fontFamily: "monospace" }}>
          {data.ejaan_umum_ipa}
        </p>
      </div>
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

  const [handle] = useState(() => delayRender("Loading Map TopoJSON..."));

  useEffect(() => {
    fetch(geoUrl)
      ? continueRender(handle)
      : null;
  }, [handle]);

  // CARI TAHU POSISI FASE SAAT INI BERDASARKAN FRAME
  const activeSegment = useMemo(() => {
    return timelineSegments.find(s => frame >= s.start && frame < s.end) || timelineSegments[timelineSegments.length - 1];
  }, [frame, timelineSegments]);

  // FUNGSI UNTUK MENENTUKAN APAKAH TITIK SUDAH DILEWATI
  const getReachedFrame = (idx) => {
    const staySeg = timelineSegments.find(s => s.type === "stay" && s.fromIdx === idx);
    return staySeg ? staySeg.start : Infinity;
  };

  // KALKULASI ZOOM / SKALA KAMERA
  const MIN_SCALE = (width * 0.9) / 2; // 90% dari viewport
  // Fallback zoom default (4.0) jika properti zoom tidak ada di json
  const getTargetScale = (idx) => MIN_SCALE * (route[idx].zoom || 4.0); 

  let currentCoords = route[0].coords;
  let currentScale = MIN_SCALE;
  let legProgress = 0;

  if (activeSegment.type === "intro") {
    currentCoords = route[0].coords;
    const progress = interpolate(frame - activeSegment.start, [0, activeSegment.end - activeSegment.start], [0, 1]);
    currentScale = MIN_SCALE + (getTargetScale(0) - MIN_SCALE) * Easing.in(Easing.poly(3))(progress);
  } 
  else if (activeSegment.type === "stay") {
    currentCoords = route[activeSegment.fromIdx].coords;
    currentScale = getTargetScale(activeSegment.fromIdx);
  } 
  else if (activeSegment.type === "move") {
    const progress = (frame - activeSegment.start) / (activeSegment.end - activeSegment.start);
   legProgress = Easing.in(Easing.sin)(progress);

    const p0 = route[activeSegment.fromIdx].coords;
    const p2 = route[activeSegment.toIdx].coords;
    const cp = getControlPoint(p0, p2, BEND_FACTOR);
    currentCoords = getQuadraticBezierPoint(p0, cp, p2, legProgress);

    // Animasi Zoom Overlap saat bergerak
    const ZOOM_ABS_DUR = 60;
    const framesInSegment = frame - activeSegment.start;
    
    // Zoom Out
    const outProgress = Math.min(1, framesInSegment / ZOOM_ABS_DUR);
    const scaleOut = getTargetScale(activeSegment.fromIdx) - (getTargetScale(activeSegment.fromIdx) - MIN_SCALE) * Easing.in(Easing.poly(3))(outProgress);
    
    // Zoom In
    let scaleIn = MIN_SCALE;
    const inStartFrame = (activeSegment.end - activeSegment.start) - ZOOM_ABS_DUR;
    if (framesInSegment > inStartFrame) {
      const inProgress = Math.min(1, (framesInSegment - inStartFrame) / ZOOM_ABS_DUR);
      scaleIn = MIN_SCALE + (getTargetScale(activeSegment.toIdx) - MIN_SCALE) * Easing.in(Easing.poly(3))(inProgress);
    }
    
    currentScale = Math.max(scaleOut, scaleIn);
  } 
  else if (activeSegment.type === "outro") {
    currentCoords = route[activeSegment.fromIdx].coords;
    const progress = Math.min(1, (frame - activeSegment.start) / (activeSegment.end - activeSegment.start));
    currentScale = getTargetScale(activeSegment.fromIdx) - (getTargetScale(activeSegment.fromIdx) - MIN_SCALE) * Easing.out(Easing.poly(3))(progress);
  }

  // RENDER GARIS MELENGKUNG (Tetap dipertahankan dengan logika timing baru)
  const renderableSegments = useMemo(() => {
    const segments = [];
    for (let l = 0; l < route.length - 1; l++) {
      const moveSeg = timelineSegments.find(s => s.type === "move" && s.fromIdx === l);
      if (!moveSeg) continue;

      let progressLimit = 0;
      if (frame >= moveSeg.end) progressLimit = 1; // Garis full karena sudah dilewati
      else if (frame >= moveSeg.start && frame < moveSeg.end) {
     progressLimit = Easing.in(Easing.sin)((frame - moveSeg.start) / (moveSeg.end - moveSeg.start));
      }

      if (progressLimit > 0) {
        const numSteps = Math.max(30, Math.floor(progressLimit * 150));
        const p0 = route[l].coords;
        const p2 = route[l+1].coords;
        const cp = getControlPoint(p0, p2, BEND_FACTOR);

        for (let i = 0; i < numSteps; i++) {
          const t1 = (i / numSteps) * progressLimit;
          const t2 = ((i + 1) / numSteps) * progressLimit;

          segments.push({
            key: `leg-${l}-step-${i}`,
            from: getQuadraticBezierPoint(p0, cp, p2, t1),
            to: getQuadraticBezierPoint(p0, cp, p2, t2),
            progress: t1
          });
        }
      }
    }
    return segments;
  }, [route, timelineSegments, frame]);

  // Audio Sequencer (Menyatukan file Mp3 persis dengan fase "Stay")
  const renderAudio = () => {
    return timelineSegments.filter(s => s.type === "stay").map((seg, idx) => {
      const audioUrl = route[idx].sound_file;
      if (!audioUrl) return null;
      return (
        <Sequence key={`audio-${idx}`} from={seg.audioStartFrame} durationInFrames={seg.end - seg.start}>
          <Audio src={staticFile(audioUrl)} />
        </Sequence>
      );
    });
  };

  return (
    <div style={{ width: "100%", height: "100%", backgroundColor: "#0f172a", display: "flex", justifyContent: "center", alignItems: "center", overflow: "hidden", fontFamily: "system-ui, sans-serif" }}>
      
      {/* OVERLAY TEKS DATA NEGARA SAAT DIAM (AUDIO PLAY) */}
      {activeSegment.type === "stay" && (
        <InfoOverlay data={route[activeSegment.fromIdx]} segment={activeSegment} frame={frame} fps={fps} />
      )}

      {/* RENDER SEMUA AUDIO */}
      {renderAudio()}

      <div style={{ width: "100%", height: "100%", transform: "translateY(-10%)" }}>
        <ComposableMap
          projection="geoOrthographic"
          width={width}
          height={height}
          projectionConfig={{
            rotate: [-currentCoords[0], -currentCoords[1], 0],
            scale: currentScale,
            precision: 0.1,
            clipAngle: 90,
          }}
          style={{ width: "100%", height: "100%" }}
        >
          <defs>
            <filter id="neonGlow" x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur1" />
              <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur2" />
              <feMerge>
                <feMergeNode in="blur2" />
                <feMergeNode in="blur1" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <Sphere fill="#0284c7" stroke="none" />

          <Geographies geography={geoUrl}>
            {({ geographies }) => {
              const sortedGeographies = [...geographies].sort((a, b) => {
                const indexA = route.findIndex((w) => w.country === a.properties.name);
                const indexB = route.findIndex((w) => w.country === b.properties.name);
                const isVisitedA = indexA !== -1 && frame >= getReachedFrame(indexA);
                const isVisitedB = indexB !== -1 && frame >= getReachedFrame(indexB);
                return (isVisitedA ? indexA + 1 : 0) - (isVisitedB ? indexB + 1 : 0);
              });

              return sortedGeographies.map((geo) => {
                const countryKey = geo.properties.name || geo.rsmKey;
                const countryColor = getRandomColor(countryKey);

                const wpIndex = route.findIndex((w) => w.country === countryKey);
                const reachedFrame = wpIndex !== -1 ? getReachedFrame(wpIndex) : Infinity;
                const isVisited = frame >= reachedFrame;

                const glowScale = isVisited
                  ? spring({ frame: frame - reachedFrame, fps, config: { damping: 15, stiffness: 100 } })
                  : 0;

                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={countryColor}
                    stroke={isVisited ? "#ffffff" : "none"}
                    strokeWidth={isVisited ? glowScale * 1.5 : 0}
                    style={{
                      default: { 
                        outline: "none", 
                        shapeRendering: "geometricPrecision",
                        filter: isVisited ? `drop-shadow(0px 0px ${glowScale * 15}px ${countryColor})` : "none",
                        transition: "all 0.2s ease-in-out"
                      },
                      hover: { outline: "none" }, pressed: { outline: "none" },
                    }}
                  />
                );
              });
            }}
          </Geographies>

          <g style={{ filter: "url(#neonGlow)" }}>
            {renderableSegments.map((seg) => {
              const dynamicStrokeWidth = 1.5 + (8 - 1.5) * seg.progress;
              return (
                <Line
                  key={seg.key}
                  from={seg.from}
                  to={seg.to}
                  stroke="#fef08a" 
                  strokeWidth={dynamicStrokeWidth}
                  strokeLinecap="round"
                />
              );
            })}
          </g>

          {/* Marker yang bergerak (Pucuk Garis) */}
          {activeSegment.type !== "outro" && (
            <Marker coordinates={currentCoords}>
              <circle r={9} fill="#ffffff" stroke="#fef08a" strokeWidth={3} style={{ filter: "url(#neonGlow)" }} />
            </Marker>
          )}

          {/* Marker Titik Negara */}
          {route.map((wp, index) => {
            const reachedFrame = getReachedFrame(index);
            const isReached = frame >= reachedFrame;
            if (!isReached) return null;

            const scale = Math.max(0, spring({ frame: frame - reachedFrame, fps, config: { damping: 12 } }));

            return (
              <Marker key={wp.country} coordinates={wp.coords}>
                <g transform={`scale(${scale})`}>
                  <circle
                    r={index === 0 ? 6 : 8}
                    fill={index === 0 ? "#f43f5e" : "#fef08a"}
                    stroke="#0f172a"
                    strokeWidth={2}
                    style={index !== 0 ? { filter: "url(#neonGlow)" } : {}}
                  />
                  <text
                    textAnchor="middle"
                    y={-14}
                    style={{
                      fill: "#ffffff",
                      fontSize: "17px",
                      fontWeight: "800",
                      textShadow: "0px 2px 4px rgba(0,0,0,0.8)",
                    }}
                  >
                    {wp.country}
                  </text>
                </g>
              </Marker>
            );
          })}
        </ComposableMap>
      </div>
    </div>
  );
};
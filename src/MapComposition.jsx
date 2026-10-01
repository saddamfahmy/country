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
  Line,
  ZoomableGroup,
} from "react-simple-maps";
import { geoBounds, geoContains } from "d3-geo";

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
const BEND_FACTOR = 0.3;
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
  name.toLowerCase().replace(/[^a-z0-9]/g, "");

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

const InfoOverlay = ({ data, segment, frame, fps }) => {
  if (!data) return null;
  
  const progress = frame - segment.start;
  const scaleIn = spring({ frame: progress, fps, config: { damping: 12 } });
  
  const opacityOut = interpolate(segment.end - frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{
      position: "absolute",
      top: "10%",
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
        <h2 style={{ margin: 0, color: "#94a3b8", fontSize: "50px", textTransform: "uppercase", letterSpacing: "2px" }}>
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
  const [autoCamMap, setAutoCamMap] = useState({});

  useEffect(() => {
    fetch(geoUrl)
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
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
  const BASE_ZOOM = 6;
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

  const renderableSegments = useMemo(() => {
    const segments = [];
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
        const numSteps = Math.max(30, Math.floor(progressLimit * 100));
        const p0 = route[l].coords;
        const p2 = route[l+1].coords;
        const cp = get2DControlPoint(p0, p2, BEND_FACTOR);

        for (let i = 0; i < numSteps; i++) {
          const t1 = (i / numSteps) * progressLimit;
          const t2 = ((i + 1) / numSteps) * progressLimit;

          segments.push({
            key: `leg-${l}-step-${i}`,
            from: get2DBezierPoint(p0, cp, p2, t1),
            to: get2DBezierPoint(p0, cp, p2, t2),
            progress: t1
          });
        }
      }
    }
    return segments;
  }, [route, timelineSegments, frame, isIntroPreview]);

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
      
      {activeSegment.type === "stay" && (
        <InfoOverlay data={route[activeSegment.fromIdx]} segment={activeSegment} frame={frame} fps={fps} />
      )}

      {renderAudio()}

      <div style={{ width: "100%", height: "100%" }}>
        <ComposableMap
          projection="geoMercator"
          width={width}
          height={height}
          style={{ width: "100%", height: "100%" }}
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
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="softGlow" />
                <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="wideGlow" />
                <feMerge>
                  <feMergeNode in="wideGlow" />
                  <feMergeNode in="softGlow" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="routeNeonGlow" x="-300%" y="-300%" width="700%" height="700%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="softGlow" />
                <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="wideGlow" />
                <feMerge>
                  <feMergeNode in="wideGlow" />
                  <feMergeNode in="softGlow" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <Geographies geography={geoUrl}>
              {({ geographies }) => {
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

                return sortedGeographies.map((geo) => {
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
                        fill={isVisited ? countryColor : "#1e293b"}
                        stroke={isVisited ? countryColor : "#334155"}
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
                          fillOpacity={neonOpacity * 0.2}
                          stroke={getLighterColor(countryColor)}
                          strokeWidth={1.8}
                          strokeOpacity={neonOpacity}
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
                          stroke="#ffffff"
                          strokeWidth={0.45}
                          strokeOpacity={neonOpacity}
                          style={{
                            default: {
                              outline: "none",
                              filter: "url(#neonGlow)",
                              pointerEvents: "none",
                            },
                            hover: { outline: "none" },
                            pressed: { outline: "none" },
                          }}
                        />
                      )}
                    </React.Fragment>
                  );
                });
              }}
            </Geographies>

            {/* Render Garis Rute */}
            <g>
              {renderableSegments.map((seg) => {
                const baseStroke = 1.8;
                const dynamicStrokeWidth = baseStroke + ((5 - baseStroke) * seg.progress);
                const scaledStrokeWidth = dynamicStrokeWidth / (cameraZoom / 2);
                return (
                  <React.Fragment key={seg.key}>
                    <Line
                      from={seg.from}
                      to={seg.to}
                      stroke="#fef08a"
                      strokeWidth={scaledStrokeWidth * 2.5}
                      strokeOpacity={0.7}
                      strokeLinecap="round"
                      style={{ filter: "url(#routeNeonGlow)" }}
                    />
                    <Line
                      from={seg.from}
                      to={seg.to}
                      stroke="#fef08a"
                      strokeWidth={scaledStrokeWidth}
                      strokeLinecap="round"
                    />
                  </React.Fragment>
                );
              })}
            </g>

            {/* --- UPDATE: Marker Titik Negara & Animasi Tertanam --- */}
            {route.map((wp, index) => {
              const reachedFrame = getReachedFrame(index);
              const isReached = markerFrame >= reachedFrame;
              if (!isReached) return null;

              // Cari frame saat titik utama (kamera) mulai bergerak meninggalkan negara ini
              const moveSeg = timelineSegments.find((s) => s.type === "move" && s.fromIdx === index);
              const leaveFrame = moveSeg ? moveSeg.start : Infinity;
              const isLeaving = markerFrame >= leaveFrame;

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
                        textShadow: "0px 0.5px 1px rgba(0,0,0,0.8)",
                        // Teks perlahan memudar (fade-out) bersamaan dengan skala yang mengecil
                        opacity: Math.max(0, 1 - scaleOut), 
                      }}
                    >
                      {wp.country}
                    </text>
                  </g>
                </Marker>
              );
            })}
          </ZoomableGroup>
        </ComposableMap>
      </div>
    </div>
  );
};
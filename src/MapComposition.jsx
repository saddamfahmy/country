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
import { geoBounds } from "d3-geo";

const geoUrl = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json";
const BEND_FACTOR = 0.3;

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

// --- HELPER UNTUK MENGISOLASI NEGARA INDUK (MENGABAIKAN WILAYAH SEBERANG LAUT) ---
const getMainLandmassBoundsAndCenter = (geoFeature, targetCoords) => {
  if (!geoFeature || !geoFeature.geometry) return null;

  const { type, coordinates } = geoFeature.geometry;

  if (type === "Polygon") {
    const [[minLng, minLat], [maxLng, maxLat]] = geoBounds(geoFeature);
    return {
      bounds: [[minLng, minLat], [maxLng, maxLat]],
      center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
    };
  }

  if (type === "MultiPolygon") {
    const validBounds = [];

    coordinates.forEach((polyCoords) => {
      const tempFeature = {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: polyCoords },
      };
      const [[pMinLng, pMinLat], [pMaxLng, pMaxLat]] = geoBounds(tempFeature);
      const pCenter = [(pMinLng + pMaxLng) / 2, (pMinLat + pMaxLat) / 2];

      const dist = Math.hypot(pCenter[0] - targetCoords[0], pCenter[1] - targetCoords[1]);

      if (dist < 30) {
        validBounds.push([[pMinLng, pMinLat], [pMaxLng, pMaxLat]]);
      }
    });

    if (validBounds.length === 0) {
      const [[minLng, minLat], [maxLng, maxLat]] = geoBounds(geoFeature);
      return {
        bounds: [[minLng, minLat], [maxLng, maxLat]],
        center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
      };
    }

    let overallMinLng = Infinity;
    let overallMinLat = Infinity;
    let overallMaxLng = -Infinity;
    let overallMaxLat = -Infinity;

    validBounds.forEach(([[minLng, minLat], [maxLng, maxLat]]) => {
      if (minLng < overallMinLng) overallMinLng = minLng;
      if (minLat < overallMinLat) overallMinLat = minLat;
      if (maxLng > overallMaxLng) overallMaxLng = maxLng;
      if (maxLat > overallMaxLat) overallMaxLat = maxLat;
    });

    return {
      bounds: [[overallMinLng, overallMinLat], [overallMaxLng, overallMaxLat]],
      center: [(overallMinLng + overallMaxLng) / 2, (overallMinLat + overallMaxLat) / 2],
    };
  }

  const [[minLng, minLat], [maxLng, maxLat]] = geoBounds(geoFeature);
  return {
    bounds: [[minLng, minLat], [maxLng, maxLat]],
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
  };
};

// --- HELPER KALKULASI KAMERA (ZOOM & CENTERING DI VIEWPORT) ---
const getAutoCamData = (geoFeature, targetCoords) => {
  const info = getMainLandmassBoundsAndCenter(geoFeature, targetCoords);
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
        <h2 style={{ margin: 0, color: "#94a3b8", fontSize: "40px", textTransform: "uppercase", letterSpacing: "2px" }}>
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

  // BASE_ZOOM diperkecil menjadi 0.7 agar tampilan zoom out/peta awal & akhir lebih luas
  const BASE_ZOOM = 6;
  let cameraCenter = route[0].coords;
  let cameraZoom = BASE_ZOOM;
  let legProgress = 0;

  if (activeSegment.type === "intro") {
    const progress = interpolate(frame - activeSegment.start, [0, activeSegment.end - activeSegment.start], [0, 1]);
    const startCenter = route[0].coords;
    const endCenter = getTargetCenter(0);
    
    cameraCenter = [
      interpolate(progress, [0, 1], [startCenter[0], endCenter[0]]),
      interpolate(progress, [0, 1], [startCenter[1], endCenter[1]]),
    ];
    cameraZoom = interpolate(Easing.in(Easing.poly(3))(progress), [0, 1], [BASE_ZOOM, getTargetZoom(0)]);
  } 
  else if (activeSegment.type === "stay") {
    const stayProgress = (frame - activeSegment.start) / (activeSegment.end - activeSegment.start);
    
    cameraZoom = getTargetZoom(activeSegment.fromIdx) + (stayProgress * 0.5);
    
    const centerCoord = getTargetCenter(activeSegment.fromIdx);
    cameraCenter = [
      centerCoord[0] + (stayProgress * 0.3),
      centerCoord[1] - (stayProgress * 0.1)
    ];
  } 
  else if (activeSegment.type === "move") {
    const progress = (frame - activeSegment.start) / (activeSegment.end - activeSegment.start);
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
    // Mengembalikan koordinat dan zoom secara halus ke posisi awal (route[0].coords & BASE_ZOOM) agar seamless loop
    const startCenter = getTargetCenter(activeSegment.fromIdx);
    const endCenter = route[0].coords;
    const progress = Math.min(1, (frame - activeSegment.start) / (activeSegment.end - activeSegment.start));
    
    cameraCenter = [
      interpolate(progress, [0, 1], [startCenter[0], endCenter[0]]),
      interpolate(progress, [0, 1], [startCenter[1], endCenter[1]]),
    ];
    cameraZoom = interpolate(Easing.out(Easing.poly(3))(progress), [0, 1], [getTargetZoom(activeSegment.fromIdx), BASE_ZOOM]);
  }

  const renderableSegments = useMemo(() => {
    const segments = [];
    for (let l = 0; l < route.length - 1; l++) {
      const moveSeg = timelineSegments.find(s => s.type === "move" && s.fromIdx === l);
      if (!moveSeg) continue;

      let progressLimit = 0;
      if (frame >= moveSeg.end) progressLimit = 1;
      else if (frame >= moveSeg.start && frame < moveSeg.end) {
        progressLimit = Easing.inOut(Easing.quad)((frame - moveSeg.start) / (moveSeg.end - moveSeg.start));
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
  }, [route, timelineSegments, frame]);

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
            </defs>

            <Geographies geography={geoUrl}>
              {({ geographies }) => {
                if (geographies && geographies.length > 0 && Object.keys(autoCamMap).length === 0) {
                  const calculatedMap = {};
                  route.forEach((target) => {
                    const matchGeo = geographies.find(
                      (g) => g.properties.name === target.country
                    );
                    if (matchGeo) {
                      calculatedMap[target.country] = getAutoCamData(matchGeo, target.coords);
                    }
                  });
                  if (Object.keys(calculatedMap).length > 0) {
                    setAutoCamMap(calculatedMap);
                  }
                }

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

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={isVisited ? countryColor : "#1e293b"}
                      stroke={isVisited ? countryColor : "#334155"}
                      strokeWidth={isVisited ? 0.25 : 0.1}
                      style={{
                        default: { 
                          outline: "none", 
                          transition: "fill 0.5s ease",
                          filter: isVisited ? "url(#neonGlow)" : "none"
                        },
                        hover: { outline: "none" }, 
                        pressed: { outline: "none" },
                      }}
                    />
                  );
                });
              }}
            </Geographies>

            {/* Render Garis Rute */}
            <g style={{ filter: "url(#neonGlow)" }}>
              {renderableSegments.map((seg) => {
                const baseStroke = 0.5;
                const dynamicStrokeWidth = baseStroke + ((2 - baseStroke) * seg.progress);
                return (
                  <Line
                    key={seg.key}
                    from={seg.from}
                    to={seg.to}
                    stroke="#fef08a" 
                    strokeWidth={dynamicStrokeWidth / (cameraZoom / 2)}
                    strokeLinecap="round"
                  />
                );
              })}
            </g>

            {/* --- UPDATE: Marker Titik Negara & Animasi Tertanam --- */}
            {route.map((wp, index) => {
              const reachedFrame = getReachedFrame(index);
              const isReached = frame >= reachedFrame;
              if (!isReached) return null;

              // Cari frame saat titik utama (kamera) mulai bergerak meninggalkan negara ini
              const moveSeg = timelineSegments.find((s) => s.type === "move" && s.fromIdx === index);
              const leaveFrame = moveSeg ? moveSeg.start : Infinity;
              const isLeaving = frame >= leaveFrame;

              // 1. Skala membesar (Scale In) saat titik tiba
              const scaleIn = Math.max(0, spring({ frame: frame - reachedFrame, fps, config: { damping: 12 } }));
              
              // 2. Skala mengecil (Scale Out) perlahan agar terlihat tertanam kembali di map
              const scaleOut = isLeaving 
                ? Math.max(0, spring({ frame: frame - leaveFrame, fps, config: { damping: 12, stiffness: 90 } })) 
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
                        fontSize: "4px",
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
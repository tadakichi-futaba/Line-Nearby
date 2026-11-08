
"use strict";

window.AppVoronoi = (() => {
  // モードごとのボロノイデータを保持
  const dataByMode = {
    turf: null,
    flat: null
  };

  // JSON形式を統一して、描画用データを作成
  function parseGeoJSON(data) {
    let geojson;

    if (
      data.type === "FeatureCollection" &&
      Array.isArray(data.features)
    ) {
      geojson = data;
    } else if (data.type === "Feature") {
      geojson = {
        type: "FeatureCollection",
        features: [data]
      };
    } else if (Array.isArray(data)) {
      geojson = {
        type: "FeatureCollection",
        features: data
      };
    } else {
      throw new Error("ボロノイ JSON の形式が未対応です");
    }

    const entries = [];

    for (const feature of geojson.features) {
      if (!feature.geometry) continue;

      const layer = L.geoJSON(feature);
      const bounds = layer.getBounds();

      if (!bounds.isValid()) continue;

      entries.push({ feature, bounds });
    }

    return { entries };
  }

  // 指定モードのボロノイデータを地図に反映
  function setMode(mode) {
    if (mode !== "turf" && mode !== "flat") {
      console.warn("未対応のボロノイモード:", mode);
      return;
    }

    const data = dataByMode[mode];

    if (!data) {
      console.warn("ボロノイデータが未読み込みです:", mode);
      return;
    }

    AppMap.setVoronoiEntries(data.entries);

    AppMap.setStatus(
      "voronoi-status",
      `ボロノイ領域: ${data.entries.length.toLocaleString()} 件（${mode === "turf" ? "precise" : "simple"}・表示範囲内のみ描画）`
    );

    console.log("Voronoi mode:", mode, data.entries.length);
  }

  // 両方のJSONを読み込む
  async function load() {
    const files = [
      { mode: "flat", url: "./voronoi_simple.json" },
      { mode: "turf", url: "./voronoi_precise.json" }
    ];

    const results = await Promise.all(
      files.map(async ({ mode, url }) => {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`${url}: HTTP ${response.status}`);
        }

        const data = await response.json();

        return {
          mode,
          parsed: parseGeoJSON(data)
        };
      })
    );

    for (const result of results) {
      dataByMode[result.mode] = result.parsed;
    }

    // 初期表示はflat方式
    setMode("flat");
  }

  return {
    load,
    setMode
  };
})();

// 既存の初期化処理との互換性を維持
window.loadVoronoi = window.AppVoronoi.load;

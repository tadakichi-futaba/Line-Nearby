// Leaflet 地図、表示範囲内のレイヤー管理、地図クリック
"use strict";

window.AppMap = (() => {
  const TOKYO_STATION = [35.6812983, 139.767065];
  const INITIAL_ZOOM = 15;

  const map = L.map("map", {
    preferCanvas: true
  }).setView(TOKYO_STATION, INITIAL_ZOOM);

  // 保存済みカメラ位置を読み込み
  function restoreCamera() {
    const camera = window.AppSettings.get("camera");

    console.log("[Camera] 読み込み:", camera);

    if (
      !camera ||
      !Number.isFinite(camera.lat) ||
      !Number.isFinite(camera.lng) ||
      !Number.isFinite(camera.zoom)
    ) {
      console.log("[Camera] 保存データなし、初期位置を使用");
      return;
    }

    map.setView(
      [camera.lat, camera.lng],
      camera.zoom,
      { animate: false }
    );

    console.log("[Camera] 復元完了");
  }

  // カメラ位置を保存
  function saveCamera() {
    const center = map.getCenter();

    const camera = {
      lat: center.lat,
      lng: center.lng,
      zoom: map.getZoom()
    };

    window.AppSettings.set("camera", camera);

    console.log("[Camera] 保存:", camera);
  }

  // 保存済み位置を復元
  restoreCamera();

  // 移動・ズームが完了したら保存
  map.on("moveend", saveCamera);

  // ズームボタンを右下へ移動
  map.zoomControl.setPosition("bottomright");

  // 背景地図タイル
  const baseMapLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors<span> | </span> 駅データ: <a href="https://github.com/Seo-4d696b75/station_database">station_database</a> (<a href="https://creativecommons.org/licenses/by/4.0/deed.ja">CC BY 4.0</a>)',
      maxZoom: 19
    }
  ).addTo(map);

  // 背景地図の彩度・不透明度
  function updateBaseMapStyle() {
    const saturation =
      document.getElementById("map-saturation")?.value ?? 100;

    const opacity =
      document.getElementById("map-opacity")?.value ?? 100;

    const container = baseMapLayer.getContainer();

    if (container) {
      container.style.filter = `saturate(${saturation}%)`;
    }

    baseMapLayer.setOpacity(Number(opacity) / 100);

    const saturationValue =
      document.getElementById("map-saturation-value");
    const opacityValue =
      document.getElementById("map-opacity-value");

    if (saturationValue) {
      saturationValue.textContent = `${saturation}%`;
    }

    if (opacityValue) {
      opacityValue.textContent = `${opacity}%`;
    }
  }

  // ボロノイは見た目だけのレイヤー。クリックを受け取らず、下の路線・地図へ通す。
  map.createPane("voronoiPane");
  map.getPane("voronoiPane").style.pointerEvents = "none";
  map.getPane("voronoiPane").style.zIndex = 350;
  // 通過駅解析結果の表示専用レイヤー
  map.createPane("throughPane");
  map.getPane("throughPane").style.pointerEvents = "auto";
  map.getPane("throughPane").style.zIndex = 360;

  const VORONOI_COLORS = {
    flat: "#668823",
    turf: "#1685e5"
  };

  const voronoiLayer = L.geoJSON(null, {
    pane: "voronoiPane",
    interactive: false,
    style: {
      color: "#668823",
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0
    }
  }).addTo(map);

  function updateVoronoiStyle(mode) {
    const colors = {
      flat: "#668823",
      turf: "#1685e5"
    };

    const color = colors[mode] || "#1565c0";

    const style = {
      color,
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0
    };

    // 今後追加されるGeoJSONにも新しい色を適用
    voronoiLayer.options.style = style;

    // すでに追加されている図形にも適用
    voronoiLayer.setStyle(style);
  }

  // 近傍駅の順位マーカー用
  const nearestStationMarkerLayer = L.layerGroup().addTo(map);
  const nearestVoronoiLayer = L.layerGroup().addTo(map);
  const stationLabelLayer = L.layerGroup().addTo(map);
  const railwayLayer = L.featureGroup().addTo(map);
  const startLayer = L.layerGroup();
  const endLayer = L.layerGroup();
  // 近傍駅のVoronoi着色用
  let nearestStationsForVoronoi = [];
  // 集計結果をキーごとに保持
  const throughResults = new Map();
  // 集計結果ごとの描画レイヤー
  const throughResultLayers = new Map();
  // ホバー時の接続線は共通で1つ
  const throughLayer = L.layerGroup();
  const throughConnectorLayer = L.layerGroup();
  // 復元した下り・上り・支線等のポリライン表示
  const reconstructedRouteLayer = L.layerGroup().addTo(map);
  // 通過駅ライン表示時のカメラ自動調整設定
  let throughLineAutoFit = AppSettings.get("throughLineAutoFit", true);
  // 路線選択時にVoronoi・駅名などを非表示にする設定
  let hideVoronoiOnRouteSelect = AppSettings.get("hideVoronoiOnRouteSelect", true);
  // 路線選択直前のレイヤー表示状態
  let routeModeLayerStates = null;

  // =========================
  // レイヤー表示コントロール
  // =========================

  const overlayLayers = {
    "ボロノイ領域": voronoiLayer,
    "駅名": stationLabelLayer,
    "路線": railwayLayer,
    "路線区間の開始位置": startLayer,
    "路線区間の終了位置": endLayer
  };

  // =========================
  // 保存済みのレイヤー表示状態を復元
  // =========================

  const savedLayers = AppSettings.get("layers", {});

  for (const [name, layer] of Object.entries(overlayLayers)) {
    const visible = savedLayers[name];

    if (visible === true && !map.hasLayer(layer)) {
      map.addLayer(layer);
    } else if (visible === false && map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }

  // レイヤーコントロール
  const layerControl = L.control.layers(
    null,
    overlayLayers,
    { collapsed: true }
  ).addTo(map);

  // 表示リセットボタン
  const resetControl = L.control({
    position: "topleft"
  });

  resetControl.onAdd = function () {
    const container = L.DomUtil.create(
      "div",
      "leaflet-bar reset-map-control"
    );

    const button = L.DomUtil.create(
      "a",
      "reset-map-button",
      container
    );

    button.href = "#";
    button.title = "表示リセット";
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", "表示リセット");

    // Lucide風のリセットアイコン（SVG）
    button.innerHTML = `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
      <path d="M3 3v5h5"/>
    </svg>
  `;

    L.DomEvent.on(button, "click", function (e) {
      L.DomEvent.preventDefault(e);
      L.DomEvent.stopPropagation(e);

      window.clearSelection?.();
    });

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  };

  resetControl.addTo(map);


  // 近傍駅モード切替ボタン
  const nearestModeControl = L.control({
    position: "topright"
  });

  nearestModeControl.onAdd = function () {
    const container = L.DomUtil.create(
      "div",
      "leaflet-bar nearest-mode-control"
    );

    const button = L.DomUtil.create(
      "button",
      "nearest-mode-button",
      container
    );

    button.id = "nearest-mode-toggle";
    button.type = "button";

    // 既存ボタンと同じ初期表示
    button.textContent = "";

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  };

  nearestModeControl.addTo(map);


  // 近傍N駅設定ボタン・設定パネル
  const nearestCountControl = L.control({
    position: "topright"
  });

  nearestCountControl.onAdd = function () {
    const container = L.DomUtil.create(
      "div",
      "nearest-count-control"
    );

    // 設定ボタン
    const button = L.DomUtil.create(
      "button",
      "nearest-count-open-button",
      container
    );

    button.id = "nearest-count-open";
    button.type = "button";
    button.title = "近傍N駅の設定";
    button.textContent = "12";
    button.setAttribute("aria-expanded", "false");

    // 設定パネル
    const panel = L.DomUtil.create(
      "div",
      "nearest-count-popup",
      container
    );

    panel.id = "nearest-count-popup";

    // 既存の設定HTMLを移動
    const nearestControls = document.getElementById(
      "nearest-count-controls"
    );

    if (nearestControls) {
      panel.appendChild(nearestControls);
    }

    // ボタンで開閉
    L.DomEvent.on(button, "click", function (e) {
      L.DomEvent.stop(e);

      const isOpen = panel.classList.contains("popup-open");

      panel.classList.toggle("popup-open", !isOpen);
      button.setAttribute("aria-expanded", String(!isOpen));
    });

    // パネル内の操作で地図にイベントを伝えない
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    return container;
  };

  nearestCountControl.addTo(map);

  // =========================
  // 設定項目の追加
  // =========================

  const layerList = layerControl
    .getContainer()
    .querySelector(".leaflet-control-layers-list");

  function addLayerSetting(element) {
    element.style.cssText = [
      "display:block",
      "padding:6px 0 2px",
      "border-top:1px solid #ccc"
    ].join(";");

    layerList.appendChild(element);

    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
  }


  // ライン表示時に地図を自動調整
  const autoFitSetting = document.createElement("label");
  autoFitSetting.id = "through-line-auto-fit";
  autoFitSetting.style.cursor = "pointer";

  const autoFitCheckbox = document.createElement("input");
  autoFitCheckbox.type = "checkbox";
  autoFitCheckbox.checked = throughLineAutoFit;
  autoFitCheckbox.style.marginRight = "6px";

  autoFitCheckbox.addEventListener("change", () => {
    throughLineAutoFit = autoFitCheckbox.checked;

    AppSettings.set(
      "throughLineAutoFit",
      throughLineAutoFit
    );
  });

  autoFitSetting.append(
    autoFitCheckbox,
    document.createTextNode("路線近傍駅表示時にカメラを自動調整")
  );

  addLayerSetting(autoFitSetting);

  // 路線選択時はボロノイと駅名を非表示
  const hideVoronoiSetting = document.createElement("label");
  hideVoronoiSetting.id = "hide-voronoi-on-route-select";
  hideVoronoiSetting.style.cursor = "pointer";

  const hideVoronoiCheckbox = document.createElement("input");
  hideVoronoiCheckbox.type = "checkbox";
  hideVoronoiCheckbox.checked = hideVoronoiOnRouteSelect;
  hideVoronoiCheckbox.style.marginRight = "6px";

  hideVoronoiCheckbox.addEventListener("change", () => {
    hideVoronoiOnRouteSelect = hideVoronoiCheckbox.checked;

    AppSettings.set(
      "hideVoronoiOnRouteSelect",
      hideVoronoiOnRouteSelect
    );

    // 路線選択中なら表示状態を即時反映
    if (selectedRouteMode) {
      applyRouteModeLayerVisibility();

      // Voronoi関連レイヤーを更新
      refreshVoronoi();
      refreshStationLabels();
      refreshNearestVoronoi();

      // 路線レイヤーも更新
      window.AppRailway?.refreshVisibleLayers();
    }
  });

  hideVoronoiSetting.append(
    hideVoronoiCheckbox,
    document.createTextNode("路線選択時は対象以外を非表示")
  );

  addLayerSetting(hideVoronoiSetting);


  // =========================
  // 背景地図の表示設定
  // =========================

  const settings = document.createElement("div");

  settings.style.cssText = [
    "border-top:1px solid #ccc",
    "margin-top:8px",
    "padding:8px 4px 2px",
    "min-width:180px"
  ].join(";");

  settings.innerHTML = `
  <div style="font-weight:bold;margin-bottom:8px">
    背景地図の表示設定
  </div>

  <label for="map-saturation" style="display:block;margin-bottom:3px">
    彩度：
    <span id="map-saturation-value">100%</span>
  </label>
  <input
    id="map-saturation"
    type="range"
    min="0"
    max="200"
    step="10"
    value="100"
    style="width:100%;margin:0 0 10px"
  >

  <label for="map-opacity" style="display:block;margin-bottom:3px">
    不透明度：
    <span id="map-opacity-value">50%</span>
  </label>
  <input
    id="map-opacity"
    type="range"
    min="0"
    max="100"
    step="5"
    value="50"
    style="width:100%;margin:0 0 4px"
  >
`;

  layerList.appendChild(settings);

  L.DomEvent.disableClickPropagation(settings);
  L.DomEvent.disableScrollPropagation(settings);


  // =========================
  // 背景地図設定の復元
  // =========================

  const saturationInput = settings.querySelector("#map-saturation");
  const opacityInput = settings.querySelector("#map-opacity");

  saturationInput.value = AppSettings.get("saturation", 100);
  opacityInput.value = AppSettings.get("opacity", 50);


  // =========================
  // 背景地図設定の保存
  // =========================

  function saveBackgroundSettings() {
    AppSettings.update({
      saturation: Number(saturationInput.value),
      opacity: Number(opacityInput.value)
    });

    updateBaseMapStyle();
  }

  saturationInput.addEventListener("input", saveBackgroundSettings);
  opacityInput.addEventListener("input", saveBackgroundSettings);


  // 初期設定を反映
  updateBaseMapStyle();


  // =========================
  // レイヤー表示状態の保存
  // =========================

  function saveLayerVisibility() {
    const layers = {};

    for (const [name, layer] of Object.entries(overlayLayers)) {
      layers[name] = map.hasLayer(layer);
    }

    AppSettings.set("layers", layers);
  }

  map.on("overlayadd", saveLayerVisibility);
  map.on("overlayremove", saveLayerVisibility);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function setStatus(id, message, isError = false) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("status-error", isError);
  }
  function fitLayer(layer, maxZoom = 12) {
    const bounds = layer.getBounds?.();
    if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20], maxZoom });
  }
  function makeEndpointIcon(type, label) {
    return L.divIcon({ className: "", html: `<div class="endpoint-icon ${type}">${label}</div>`, iconSize: [30, 24], iconAnchor: [15, 12] });
  }

  const LABEL_MIN_ZOOM = 12;
  let voronoiEntries = [];
  let labelFeatures = [];
  let selectedRouteMode = false;
  let clickMarker = null;

  function refreshVoronoi() {
    voronoiLayer.clearLayers();

    if (
      (selectedRouteMode && hideVoronoiOnRouteSelect) ||
      !map.hasLayer(voronoiLayer)
    ) {
      refreshNearestVoronoi();
      return;
    }

    const bounds = map.getBounds();

    for (const entry of voronoiEntries) {
      if (entry.bounds.intersects(bounds)) {
        voronoiLayer.addData(entry.feature);
      }
    }

    // 近傍駅の着色も更新
    refreshNearestVoronoi();
  }

  function refreshStationLabels() {
    stationLabelLayer.clearLayers();

    if (
      !map.hasLayer(stationLabelLayer) ||
      map.getZoom() < LABEL_MIN_ZOOM
    ) {
      return;
    }

    // 表示範囲を少し拡張（画面サイズの10%ずつ）
    const bounds = map.getBounds().pad(0.1);

    // attrとマーカー色の対応
    const attrColors = {
      eco: "#16a34a",
      heat: "#dc2626",
      cool: "#2563eb"
    };

    for (const item of labelFeatures) {
      if (!bounds.contains(item.latlng)) continue;

      const color = attrColors[item.attr] ?? "#808080";

      const html = `
      <div class="station-label-content">
        <span
          class="station-label-dot"
          style="background-color:${color}"
        ></span>
        <span class="station-label-text">
          ${escapeHtml(item.name)}
        </span>
      </div>
    `;

      stationLabelLayer.addLayer(
        L.marker(item.latlng, {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: "station-name-label",
            html,
            iconSize: [120, 32],
            iconAnchor: [60, 0]
          })
        })
      );
    }
  }

  function setVoronoiEntries(entries) {
    voronoiEntries = entries;
    refreshVoronoi();
  }
  function setStationLabelFeatures(features) {
    labelFeatures = features;
    refreshStationLabels();
  }
  // 路線選択前のレイヤー表示状態を保存
  function saveRouteModeLayerStates() {
    routeModeLayerStates = new Map([
      [voronoiLayer, map.hasLayer(voronoiLayer)],
      [stationLabelLayer, map.hasLayer(stationLabelLayer)],
      [nearestVoronoiLayer, map.hasLayer(nearestVoronoiLayer)],
      [nearestStationMarkerLayer, map.hasLayer(nearestStationMarkerLayer)]
    ]);
  }

  // 路線選択前のレイヤー表示状態に戻す
  function restoreRouteModeLayerStates(clearSaved = true) {
    if (!routeModeLayerStates) return;

    for (const [layer, visible] of routeModeLayerStates) {
      if (visible && !map.hasLayer(layer)) {
        map.addLayer(layer);
      } else if (!visible && map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    }

    if (clearSaved) {
      routeModeLayerStates = null;
    }

    // 最新の近傍駅情報で描画し直す
    refreshNearestVoronoi();
  }

  // 路線選択時のレイヤー表示を反映
  function applyRouteModeLayerVisibility() {
    if (!selectedRouteMode) return;

    // OFFなら選択前の表示状態に戻す
    // 保存状態は維持しておく
    if (!hideVoronoiOnRouteSelect) {
      restoreRouteModeLayerStates(false);

      // 各レイヤーを再描画
      refreshVoronoi();
      refreshStationLabels();
      refreshNearestVoronoi();

      return;
    }

    // ONなら対象レイヤーを非表示
    for (const layer of [
      voronoiLayer,
      stationLabelLayer,
      nearestVoronoiLayer,
      nearestStationMarkerLayer
    ]) {
      if (map.hasLayer(layer)) {
        map.removeLayer(layer);
      }
    }
  }
  function setRouteMode(enabled) {
    // 路線選択モードへ入る
    if (enabled && !selectedRouteMode) {
      saveRouteModeLayerStates();
    }

    selectedRouteMode = enabled;

    if (enabled) {
      // 設定に応じて通常レイヤーを非表示
      applyRouteModeLayerVisibility();

      // 表示対象の集計結果があれば描画
      if ([...throughResults.values()].some(entry => entry.visible)) {
        if (!map.hasLayer(throughLayer)) {
          map.addLayer(throughLayer);
        }

        refreshThroughLayer();
      }
    } else {
      // 全路線表示に戻ったら通過駅のボロノイを非表示
      if (map.hasLayer(throughLayer)) {
        map.removeLayer(throughLayer);
      }

      if (map.hasLayer(throughConnectorLayer)) {
        map.removeLayer(throughConnectorLayer);
      }

      throughConnectorLayer.clearLayers();

      // 路線選択前の表示状態に戻す
      restoreRouteModeLayerStates();

      // 通常のVoronoi・駅名を更新
      refreshVoronoi();
      refreshStationLabels();
      refreshNearestVoronoi();
    }
  }

  function stationKeys(station) {
    const keys = [];
    if (station.id != null) keys.push(`id:${station.id}`);
    if (station.code != null) keys.push(`code:${station.code}`);
    return keys;
  }

  function getFeatureStationKeys(feature) {
    const p = feature.properties || {};
    const keys = [];

    const id = p.id ?? p.station_id;
    const code = p.code ?? p.station_code;

    if (id != null) keys.push(`id:${id}`);
    if (code != null) keys.push(`code:${code}`);

    return keys;
  }

  function getThroughStationMap() {
    const mapByKey = new Map();

    for (const entry of throughResults.values()) {
      if (!entry.visible) continue;

      const result = entry.result;
      if (!result) continue;

      for (const station of result.nearestStations || []) {
        for (const key of stationKeys(station)) {
          mapByKey.set(key, {
            ...station,
            throughType: "nearest"
          });
        }
      }

      for (const station of result.nearbyStations || []) {
        for (const key of stationKeys(station)) {
          if (!mapByKey.has(key)) {
            mapByKey.set(key, {
              ...station,
              throughType:
                station.sourceType === "nearest-station"
                  ? "added"
                  : "nearby"
            });
          }
        }
      }
    }

    return mapByKey;
  }

  function getThroughStyle(station) {
    if (station.throughType === "nearest") {
      return {
        color: "#ffa500",
        weight: 2,
        opacity: 1,
        fillColor: "#ffff00",
        fillOpacity: 0.3
      };
    }

    if (station.throughType === "added") {
      return {
        color: "#ff1493",
        weight: 2,
        opacity: 1,
        fillColor: station.rankColor || "#f48fb1",
        fillOpacity: 0.3
      };
    }

    return {
      color: station.rankColor || "#6495ed",
      weight: 1,
      opacity: 1,
      fillColor: station.rankColor || "#90caf9",
      fillOpacity: 0.3
    };
  }

  function refreshThroughLayer() {
    throughLayer.clearLayers();
    throughConnectorLayer.clearLayers();

    console.log("[Through] refresh", {
      resultCount: throughResults.size,
      visibleCount: [...throughResults.values()]
        .filter(entry => entry.visible).length,
      selectedRouteMode,
      throughLayerOnMap: map.hasLayer(throughLayer),
      voronoiEntries: voronoiEntries.length
    });

    if (
      throughResults.size === 0 ||
      !map.hasLayer(throughLayer)
    ) {
      console.log("[Through] 描画中止");
      return;
    }

    const bounds = map.getBounds();
    const stationMap = getThroughStationMap();
    console.log("[Through] 登録データ詳細",
      [...throughResults.entries()].map(([key, entry]) => ({
        key,
        visible: entry.visible,
        hasResult: !!entry.result,
        resultKeys: entry.result ? Object.keys(entry.result) : [],
        nearestCount: entry.result?.nearestStations?.length,
        nearbyCount: entry.result?.nearbyStations?.length
      }))
    );

    for (const entry of voronoiEntries) {
      if (!entry.bounds.intersects(bounds)) continue;

      const keys = getFeatureStationKeys(entry.feature);
      if (entry === voronoiEntries[0]) {
        console.log("[Through] キー照合サンプル", {
          featureKeys: keys,
          matched: keys.filter(key => stationMap.has(key)),
          stationMapKeys: [...stationMap.keys()].slice(0, 10)
        });
      }
      let station = null;

      for (const key of keys) {
        if (stationMap.has(key)) {
          station = stationMap.get(key);
          break;
        }
      }

      if (!station) continue;

      const featureLayer = L.geoJSON(entry.feature, {
        pane: "throughPane",
        interactive: true,
        style: getThroughStyle(station)
      });

      featureLayer.eachLayer(polygon => {
        polygon.on("mouseover", () => {
          throughConnectorLayer.clearLayers();

          if (
            !station.sourcePoint ||
            !Number.isFinite(Number(station.lat)) ||
            !Number.isFinite(Number(station.lng))
          ) {
            return;
          }

          // 解析時に対応付けられた座標
          const source = L.latLng(
            station.sourcePoint.lat,
            station.sourcePoint.lng
          );

          // 対応する駅そのものの座標
          const stationPoint = L.latLng(
            Number(station.lat),
            Number(station.lng)
          );

          L.polyline([source, stationPoint], {
            pane: "throughPane",
            color: "#e91e63",
            weight: 3,
            opacity: 0.95,
            interactive: false
          }).addTo(throughConnectorLayer);
        });

        polygon.on("mouseout", () => {
          throughConnectorLayer.clearLayers();
        });

        // 領域クリック時に既存の地図クリック処理を発火させない
        polygon.on("click", event => {
          L.DomEvent.stopPropagation(event);
        });
      });

      throughLayer.addLayer(featureLayer);
    }

    throughConnectorLayer.addTo(map);
    console.log("[Through] 描画完了", {
      polygonCount: throughLayer.getLayers().length,
      connectorCount: throughConnectorLayer.getLayers().length
    });
  }

  function setThroughResult(key, result) {
    throughResults.set(String(key), {
      result,
      visible: true
    });

    if (selectedRouteMode) {
      if (!map.hasLayer(throughLayer)) {
        map.addLayer(throughLayer);
      }

      refreshThroughLayer();
    }
  }
  function setThroughResultVisible(key, visible) {
    key = String(key);

    const entry = throughResults.get(key);
    if (!entry) return;

    entry.visible = Boolean(visible);

    if (selectedRouteMode) {
      refreshThroughLayer();
    }
  }

  function hideAllThroughResults(exceptKey = null) {
    for (const [key, entry] of throughResults.entries()) {
      if (key !== exceptKey) {
        entry.visible = false;
      }
    }

    if (selectedRouteMode) {
      refreshThroughLayer();
    }
  }

  function clearThroughResult() {
    throughResults.clear();

    throughLayer.clearLayers();
    throughConnectorLayer.clearLayers();

    if (map.hasLayer(throughLayer)) {
      map.removeLayer(throughLayer);
    }

    if (map.hasLayer(throughConnectorLayer)) {
      map.removeLayer(throughConnectorLayer);
    }
  }

  // 復元ポリラインをすべて消去
  function clearReconstructedRoute() {
    reconstructedRouteLayer.clearLayers();
  }

  // 復元した経路を地図に表示
  function showReconstructedRoutes(routes, options = {}) {
    reconstructedRouteLayer.clearLayers();

    const colors = {
      down: "#e53935",
      up: "#1976d2",
      remaining: "#00ff00"
    };

    for (const route of routes) {
      if (!Array.isArray(route.coordinates) ||
        route.coordinates.length < 2) {
        continue;
      }

      L.polyline(route.coordinates, {
        color: colors[route.type] || "#8e24aa",
        weight: 5,
        opacity: 0.95
      }).addTo(reconstructedRouteLayer);
    }

    if (options.fit !== false) {
      fitLayer(reconstructedRouteLayer, 14);
    }
  }

  // 近傍駅の順位マーカーを更新
  function refreshNearestStationMarkers() {
    nearestStationMarkerLayer.clearLayers();

    if (nearestStationsForVoronoi.length === 0) {
      return;
    }

    // 表示範囲を少し拡張
    const bounds = map.getBounds().pad(0.1);

    nearestStationsForVoronoi.forEach((station, index) => {
      const latlng = L.latLng(station.lat, station.lng);

      if (!bounds.contains(latlng)) return;

      const color = station.rankColor || "#6495ed";
      const rank = station.displayRank ?? (index + 1);

      const html = `
        <div class="nearest-rank-marker"
             style="background-color:${color}">
          ${rank}
        </div>
      `;

      nearestStationMarkerLayer.addLayer(
        L.marker(latlng, {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: "nearest-rank-marker-container",
            html,
            iconSize: [22, 22],

            // 駅座標より約19px上に表示
            iconAnchor: [13, 27]
          })
        })
      );
    });
  }

  // 近傍駅のVoronoi着色を更新
  function refreshNearestVoronoi() {
    nearestVoronoiLayer.clearLayers();
    // 順位マーカーも更新
    refreshNearestStationMarkers();

    if (
      !map.hasLayer(voronoiLayer) ||
      nearestStationsForVoronoi.length === 0
    ) {
      return;
    }

    // 近傍駅を id / code で検索できるようにする
    const stationMap = new Map();

    for (const station of nearestStationsForVoronoi) {
      if (station.id != null) {
        stationMap.set(`id:${station.id}`, station);
      }

      if (station.code != null && station.code !== "") {
        stationMap.set(`code:${station.code}`, station);
      }
    }

    const bounds = map.getBounds();

    for (const entry of voronoiEntries) {
      if (!entry.bounds.intersects(bounds)) continue;

      const keys = getFeatureStationKeys(entry.feature);

      let station = null;

      for (const key of keys) {
        if (stationMap.has(key)) {
          station = stationMap.get(key);
          break;
        }
      }

      if (!station) continue;

      const isAdded = station.isAddedNearest === true;
      const color = station.rankColor || "#6495ed";

      const featureLayer = L.geoJSON(entry.feature, {
        pane: "voronoiPane",
        interactive: false,
        style: {
          color: isAdded ? "#ff1493" : color,
          weight: isAdded ? 2 : 1,
          opacity: 1,
          fillColor: isAdded ? (station.rankColor || "#f48fb1") : color,
          fillOpacity: 0.3
        }
      });

      nearestVoronoiLayer.addLayer(featureLayer);
    }
  }

  // stations.js から近傍駅一覧を受け取る
  function setNearestStations(stations) {
    nearestStationsForVoronoi = Array.isArray(stations)
      ? stations
      : [];

    refreshNearestVoronoi();
  }

  function clearNearestStations() {
    nearestStationsForVoronoi = [];
    nearestVoronoiLayer.clearLayers();
    nearestStationMarkerLayer.clearLayers();
    // クリック地点のマーカーを解除
    if (clickMarker) {
      map.removeLayer(clickMarker);
      clickMarker = null;
    }
    // 保存しているクリック地点も削除
    AppStations.clearNearestPoint();
  }

  function moveClickMarker(latlng) {
    if (clickMarker) {
      clickMarker.setLatLng(latlng);
    } else {
      clickMarker = L.marker(latlng).addTo(map);
    }
    map.panTo(latlng);
  }

  // =========================
  // サンプルデータ読み込み
  // =========================
  function initSampleLoadButtons() {
    document.querySelectorAll(".sample-load-button").forEach(button => {
      button.addEventListener("click", async () => {
        const inputId = button.dataset.input;
        const fileName = button.dataset.file;

        const input = document.getElementById(inputId);
        if (!input || !fileName) return;

        const originalText = button.textContent;

        try {
          button.disabled = true;
          button.textContent = "読み込み中...";

          const url = new URL(
            "geodata/" + encodeURIComponent(fileName),
            document.baseURI
          );

          const response = await fetch(url);

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const blob = await response.blob();

          const file = new File(
            [blob],
            fileName,
            {
              type: fileName.endsWith(".gpx")
                ? "application/gpx+xml"
                : "application/geo+json"
            }
          );

          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);

          input.files = dataTransfer.files;

          // 既存のファイル読み込み処理を実行
          input.dispatchEvent(
            new Event("change", { bubbles: true })
          );

        } catch (error) {
          console.error("[Sample Load]", error);

          alert(
            `サンプルデータを読み込めませんでした。\n${fileName}\n${error.message}`
          );
        } finally {
          button.disabled = false;
          button.textContent = originalText;
        }
      });
    });
  }

  initSampleLoadButtons();


  function isThroughLineAutoFitEnabled() {
    return throughLineAutoFit;
  }

  function isHideVoronoiOnRouteSelect() {
    return hideVoronoiOnRouteSelect;
  }

  function fitThroughLine(sourcePoint, stationPoint) {
    if (!throughLineAutoFit) return;

    if (
      !sourcePoint ||
      !stationPoint ||
      !Number.isFinite(Number(sourcePoint.lat)) ||
      !Number.isFinite(Number(sourcePoint.lng)) ||
      !Number.isFinite(Number(stationPoint.lat)) ||
      !Number.isFinite(Number(stationPoint.lng))
    ) {
      return;
    }

    // 2点の中間地点をカメラの中心にする
    const center = L.latLng(
      (Number(sourcePoint.lat) + Number(stationPoint.lat)) / 2,
      (Number(sourcePoint.lng) + Number(stationPoint.lng)) / 2
    );

    map.panTo(center, {
      animate: true
    });
  }


  map.on("moveend zoomend", () => {
    refreshVoronoi();
    refreshStationLabels();
    if (window.AppRailway) AppRailway.refreshVisibleLayers();
  });

  map.on("click", event => {
    // クリック地点にピンを設置・移動
    moveClickMarker(event.latlng);

    // 既存の近傍駅表示
    if (window.AppStations) {
      AppStations.showNearest(event.latlng);
    }
  });


  return {
    map,
    voronoiLayer,
    stationLabelLayer,
    railwayLayer,
    startLayer,
    endLayer,
    setStatus,
    setVoronoiEntries,
    setStationLabelFeatures,
    setRouteMode,
    setThroughResult,
    setThroughResultVisible,
    setNearestStations,
    moveClickMarker,
    clearNearestStations,
    clearThroughResult,
    clearReconstructedRoute,
    showReconstructedRoutes,
    escapeHtml,
    fitLayer,
    updateVoronoiStyle,
    hideAllThroughResults,
    isThroughLineAutoFitEnabled,
    isHideVoronoiOnRouteSelect,
    fitThroughLine,
    startIcon: makeEndpointIcon("start-icon", "S"),
    endIcon: makeEndpointIcon("end-icon", "E"),
    labelMinZoom: LABEL_MIN_ZOOM
  };
})();

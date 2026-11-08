// station.json の駅座標を読み込み、地図クリック地点から近い N 駅を表示
"use strict";

window.AppStations = (() => {
  // 近傍駅の基本数
  let nearestBaseCount = 12;

  const PREFECTURE_NAMES = [
    "",
    "北海道",
    "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都",
    "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県",
    "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県",
    "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
    "鳥取県", "島根県", "岡山県", "広島県", "山口県",
    "徳島県", "香川県", "愛媛県", "高知県",
    "福岡県", "佐賀県", "長崎県", "熊本県", "大分県",
    "宮崎県", "鹿児島県", "沖縄県"
  ];

  // 加算ボタンの設定
  const nearestBonuses = [
    { value: 4, color: "#ff69b4", selected: false },
    { value: 2, color: "#9370db", selected: false },
    { value: 2, color: "#32cd32", selected: false }
  ];

  // 30駅固定モード
  let nearestForce30 = false;

  // 実際に表示する駅数
  function getNearestCount() {
    if (nearestForce30) {
      return 30;
    }

    return nearestBaseCount +
      nearestBonuses.reduce(
        (total, bonus) => total + (bonus.selected ? bonus.value : 0),
        0
      );
  }

  // 順位に対応する丸の色
  function getNearestRankColor(index) {
    // 30駅固定中は通常色
    if (nearestForce30) {
      return null;
    }

    // 基本数までは通常色
    if (index < nearestBaseCount) {
      return null;
    }

    // 加算された順位を、選択中のボタンごとに色分け
    let bonusStart = nearestBaseCount;

    for (const bonus of nearestBonuses) {
      if (!bonus.selected) continue;

      const bonusEnd = bonusStart + bonus.value;

      if (index >= bonusStart && index < bonusEnd) {
        return bonus.color;
      }

      bonusStart = bonusEnd;
    }

    return null;
  }

  let stations = [];
  let indexedStations = null;
  let flatTree = null;
  let turfTree = null;
  let lastNearestPoint = null;

  // 駅データに対応するKD-treeを準備する
  function ensureKDTree() {
    if (indexedStations === stations && flatTree && turfTree) {
      return;
    }

    // flat方式：全駅を検索対象にする
    flatTree = AppKDTree.create(
      stations,
      station => station.lng,
      station => station.lat
    );

    // turf方式：closed=true の駅を検索対象から除外する
    const openStations = stations.filter(
      station => station.closed !== true
    );

    turfTree = AppKDTree.create(
      openStations,
      station => station.x,
      station => station.y
    );

    indexedStations = stations;
  }

  function normalizeRows(data) {
    if (Array.isArray(data)) {
      return data;
    }

    if (
      data?.type === "FeatureCollection" &&
      Array.isArray(data.features)
    ) {
      return data.features.map(feature => ({
        ...(feature.properties || {}),
        geometry: feature.geometry
      }));
    }

    if (Array.isArray(data?.stations)) return data.stations;
    if (Array.isArray(data?.data)) return data.data;

    throw new Error(
      "station.json の形式が未対応です（配列または stations 配列を想定）"
    );
  }

  function readCoordinates(row) {
    const geometry = row.geometry;
    let lat = row.lat ?? row.latitude ?? row.y;
    let lng = row.lng ?? row.lon ?? row.longitude ?? row.x;

    if (
      (lat == null || lng == null) &&
      geometry?.type === "Point" &&
      Array.isArray(geometry.coordinates)
    ) {
      [lng, lat] = geometry.coordinates;
    }

    lat = Number(lat);
    lng = Number(lng);

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return null;
    }

    return { lat, lng };
  }

  // 路線情報を取得
  async function loadLineInfo() {
    const lineMap = new Map();

    try {
      const lines = await AppData.fetchJson("./line.json");

      for (const line of lines) {
        if (line.code == null) continue;

        lineMap.set(String(line.code), {
          name: String(line.name ?? "路線名不明"),
          color: /^#[0-9a-fA-F]{3,8}$/.test(line.color ?? "")
            ? line.color
            : "#666666",
          stationSize: Number(line.station_size) || 0
        });
      }
    } catch (error) {
      console.warn("[Stations] 路線情報の取得に失敗:", error);
    }

    return lineMap;
  }

  async function load() {
    const lineInfoByCode = await loadLineInfo();

    const data = await AppData.fetchJson("./station.json");
    const rows = normalizeRows(data);

    stations = [];

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;

      const point = readCoordinates(row);
      if (!point) continue;

      const name = row.name ?? row.station_name ?? row.original_name ?? row.label ?? "名称不明";

      const stationLineCodes = Array.isArray(row.lines) ? row.lines : [];

      const stationLines = stationLineCodes.map(code => {
        const info = lineInfoByCode.get(String(code));

        return {
          code,
          name: info?.name ?? "路線不明",
          color: info?.color ?? "#666666",
          stationSize: info?.stationSize ?? 0
        };
      });

      // 駅に登録されている最初の路線
      const lineCode = stationLineCodes.length > 0
        ? stationLineCodes[0]
        : null;

      const lineInfo = lineCode != null
        ? lineInfoByCode.get(String(lineCode))
        : null;

      const prefectureCode = Number(row.prefecture);
      const prefectureName =
        PREFECTURE_NAMES[prefectureCode] || "都道府県不明";

      const projected = turf.toMercator(
        turf.point([point.lng, point.lat])
      ).geometry.coordinates;

      stations.push({
        id: row.id ?? null,
        name: String(name),
        code: row.code ?? row.id ?? "",
        lat: point.lat,
        lng: point.lng,
        x: projected[0],
        y: projected[1],
        closed: row.closed === true,
        nameKana: String(row.name_kana ?? ""),
        attr: row.attr ?? "unknown",

        prefectureCode,
        prefectureName,

        lineCode,
        lineName: lineInfo?.name ?? "路線不明",
        lineColor: lineInfo?.color ?? "#666666",
        lines: stationLines
      });
    }

    // 駅名・駅座標・属性を地図側へ渡す
    if (window.AppMap?.setStationLabelFeatures) {
      AppMap.setStationLabelFeatures(
        stations.map(station => ({
          name: station.name,
          latlng: L.latLng(station.lat, station.lng),
          attr: station.attr
        }))
      );
    }

    AppMap.setStatus(
      "stations-status",
      `駅データ: ${stations.length.toLocaleString()} 駅`
    );

    console.log("Loaded station coordinates:", stations.length);
  }


  // 近傍駅の順位付けモード
  // turf: Web Mercator平面座標
  // flat: 緯度・経度の差による平面計算

  let nearestSortMode = AppSettings.get(
    "nearestSortMode",
    "flat"
  );

  // 不正な値の場合は flat に戻す
  if (
    nearestSortMode !== "turf" &&
    nearestSortMode !== "flat"
  ) {
    nearestSortMode = "flat";
  }

  // クリック地点を基準にした近傍駅リスト
  let lastNearestBaseStations = [];

  // 追加計算も含めた現在の表示リスト
  let lastNearestStations = [];


  // 近傍駅を計算する
  // sortPoint: 順位付けの基準座標
  // distancePoint: 表示距離の基準座標
  function calculateNearest(sortPoint, distancePoint = sortPoint) {
    if (!stations.length) return [];

    ensureKDTree();

    const lat = sortPoint.lat;
    const lng = sortPoint.lng;

    const distanceLat = distancePoint.lat;
    const distanceLng = distancePoint.lng;

    let candidates;
    let projectedX;
    let projectedY;

    const count = getNearestCount();

    if (nearestSortMode === "flat") {
      // flat方式：経度・緯度を平面座標として検索
      candidates = flatTree.nearest(
        lng,
        lat,
        count
      );
    } else {
      // turf方式：Web Mercator座標で検索
      const projected = turf.toMercator(
        turf.point([lng, lat])
      ).geometry.coordinates;

      projectedX = projected[0];
      projectedY = projected[1];

      candidates = turfTree.nearest(
        projectedX,
        projectedY,
        count
      );
    }

    // 距離と順位キーは、従来と同じ定義で返す
    return candidates.map(station => {
      let sortKey;

      if (nearestSortMode === "flat") {
        const dx = station.lng - lng;
        const dy = station.lat - lat;

        sortKey = Math.hypot(dx, dy);
      } else {
        const dx = station.x - projectedX;
        const dy = station.y - projectedY;

        sortKey = Math.hypot(dx, dy);
      }

      const distance = turf.distance(
        turf.point([distanceLng, distanceLat]),
        turf.point([station.lng, station.lat]),
        { units: "kilometers" }
      ) * 1000;

      return {
        ...station,
        sortKey,
        distance
      };
    })
      .filter(station => Number.isFinite(station.sortKey))
      .sort((a, b) => a.sortKey - b.sortKey);
  }


  // 近傍駅の表示を初期化する
  function showNearest(latlng) {
    if (!stations.length) return;

    lastNearestPoint = L.latLng(latlng.lat, latlng.lng);

    // クリック地点を基準に計算
    lastNearestBaseStations = calculateNearest(
      lastNearestPoint
    );

    // 新しいクリック地点では追加分をリセット
    lastNearestStations = lastNearestBaseStations.map(
      (station, index) => ({
        ...station,
        rankColor: getNearestRankColor(index)
      })
    );

    AppDetails.showNearest(
      lastNearestPoint,
      lastNearestStations,
      nearestSortMode
    );

    // Voronoi着色を更新
    AppMap.setNearestStations(lastNearestStations);
  }

  // 駅を識別するキー
  function getStationKey(station) {
    if (station.id != null) {
      return `id:${station.id}`;
    }

    if (station.code != null) {
      return `code:${station.code}`;
    }

    return `${station.name}|${station.lat}|${station.lng}`;
  }

  // 最近傍駅の座標を基準に、未表示の近傍駅を追加する
  function addNearestFromClosestStation() {
    if (
      !lastNearestPoint ||
      lastNearestBaseStations.length === 0
    ) {
      return;
    }

    // クリック地点の最近傍駅
    const closestStation = lastNearestBaseStations[0];

    // その駅の座標から近傍N駅を再計算する。
    // 表示距離はクリック地点からの距離を維持する。
    const candidates = calculateNearest(
      L.latLng(closestStation.lat, closestStation.lng),
      lastNearestPoint
    );

    // 現在表示済みの駅を記録
    const existingKeys = new Set(
      lastNearestStations.map(getStationKey)
    );

    // 未表示の駅だけを抽出
    const newStations = candidates.filter(station => {
      const key = getStationKey(station);

      if (existingKeys.has(key)) {
        return false;
      }

      existingKeys.add(key);
      return true;
    });

    if (newStations.length === 0) {
      return;
    }

    // 既存リストの末尾に追加
    // 最近傍駅を基準に計算した際の順位を保持して追加
    const appendedStations = newStations.map(station => {
      const rank = candidates.findIndex(
        candidate =>
          getStationKey(candidate) === getStationKey(station)
      );

      return {
        ...station,

        // 表示順位は追加元の計算結果に基づく
        displayRank: rank + 1,

        // 追加駅であることを示す
        isAddedNearest: true,

        // 順位色も追加元の順位に基づく
        rankColor: getNearestRankColor(rank)
      };
    });

    lastNearestStations = [
      ...lastNearestStations,
      ...appendedStations
    ];

    AppDetails.showNearest(
      lastNearestPoint,
      lastNearestStations,
      nearestSortMode
    );

    // Voronoi着色を更新
    AppMap.setNearestStations(lastNearestStations);
  }

  // details.js のボタンから追加計算を呼び出す
  window.addEventListener(
    "add-nearest-from-closest",
    addNearestFromClosestStation
  );

  // 近傍駅のモード切替
  function initNearestModeToggle() {
    const button = document.getElementById(
      "nearest-mode-toggle"
    );

    if (!button) {
      console.warn("nearest-mode-toggle button not found");
      return;
    }

    // =========================
    // 保存済み設定の復元
    // =========================

    const savedSettings = AppSettings.getAll();

    if (Number.isFinite(savedSettings.nearestBaseCount)) {
      nearestBaseCount = Math.max(1, savedSettings.nearestBaseCount);
    }

    if (Array.isArray(savedSettings.nearestBonuses)) {
      nearestBonuses.forEach((bonus, index) => {
        if (typeof savedSettings.nearestBonuses[index] === "boolean") {
          bonus.selected = savedSettings.nearestBonuses[index];
        }
      });
    }

    if (typeof savedSettings.nearestForce30 === "boolean") {
      nearestForce30 = savedSettings.nearestForce30;
    }

    function updateButton() {
      const isFlat = nearestSortMode === "flat";

      button.textContent =
        nearestSortMode === "turf"
          ? "駅奪取"
          : "駅メモ";

      button.setAttribute(
        "aria-label",
        `近傍駅の順位付け方式：${nearestSortMode}`
      );

      button.classList.toggle("nearest-mode-flat", isFlat);
      button.classList.toggle("nearest-mode-turf", !isFlat);
      window.AppMap.updateVoronoiStyle(nearestSortMode);
    }

    // 先に保存済みのモードをボタンへ反映
    updateButton();

    // Voronoi側にも初期モードを反映
    if (window.AppVoronoi) {
      window.AppVoronoi.setMode(nearestSortMode);
    }

    button.addEventListener("click", () => {
      nearestSortMode =
        nearestSortMode === "turf" ? "flat" : "turf";

      // 設定を保存
      AppSettings.set("nearestSortMode", nearestSortMode);

      updateButton();

      // ボロノイ図のモードも切り替える
      if (window.AppVoronoi) {
        window.AppVoronoi.setMode(nearestSortMode);
      } else {
        console.error("AppVoronoi が初期化されていません");
      }

      // 近傍駅一覧も再計算
      if (lastNearestPoint) {
        showNearest(lastNearestPoint);
      }
    });
  }

  // =========================
  // 近傍駅設定の保存・復元
  // =========================

  function saveNearestSettings() {
    AppSettings.update({
      nearestBaseCount,
      nearestBonuses: nearestBonuses.map(
        bonus => bonus.selected
      ),
      nearestForce30
    });
  }

  function initNearestCountControls() {
    const slider = document.getElementById("nearest-count-slider");
    const minusButton = document.getElementById("nearest-count-minus");
    const plusButton = document.getElementById("nearest-count-plus");
    const countValue = document.getElementById("nearest-count-value");
    const totalValue = document.getElementById("nearest-count-total-value");
    const force30Button = document.getElementById("nearest-count-force-30");

    const bonusButtons = [
      ...document.querySelectorAll(".nearest-count-bonus")
    ];

    if (
      !slider ||
      !minusButton ||
      !plusButton ||
      !countValue ||
      !totalValue ||
      !force30Button
    ) {
      console.warn("近傍駅数の操作UIが見つかりません");
      return;
    }

    // =========================
    // 保存済み設定の復元
    // =========================

    const savedSettings = AppSettings.getAll();

    if (Number.isFinite(savedSettings.nearestBaseCount)) {
      nearestBaseCount = Math.max(1, savedSettings.nearestBaseCount);
    }

    if (Array.isArray(savedSettings.nearestBonuses)) {
      nearestBonuses.forEach((bonus, index) => {
        if (typeof savedSettings.nearestBonuses[index] === "boolean") {
          bonus.selected = savedSettings.nearestBonuses[index];
        }
      });
    }

    if (typeof savedSettings.nearestForce30 === "boolean") {
      nearestForce30 = savedSettings.nearestForce30;
    }

    // 地図上の近傍N駅設定ボタンを更新
    function updateNearestCountButton() {
      const button = document.getElementById("nearest-count-open");
      const totalValue = document.getElementById("nearest-count-total-value");

      if (!button || !totalValue) return;

      // 中央に表示する駅数
      button.innerHTML = `
        <span class="nearest-count-label">near</span>
        <span class="nearest-count-number">${totalValue.textContent.replace("駅", "")}</span>
      `;

      // 色クラスを一度リセット
      button.classList.remove(
        "count-bonus-4",
        "count-bonus-2a",
        "count-bonus-2b",
        "count-multiple",
        "count-force-30"
      );

      // 30駅固定が最優先
      if (nearestForce30) {
        button.classList.add("count-force-30");
        return;
      }

      // 有効なボーナスを取得
      const selectedIndexes = nearestBonuses
        .map((bonus, index) => bonus.selected ? index : -1)
        .filter(index => index !== -1);

      if (selectedIndexes.length >= 2) {
        button.classList.add("count-multiple");
      } else if (selectedIndexes.length === 1) {
        const classes = [
          "count-bonus-4",
          "count-bonus-2a",
          "count-bonus-2b"
        ];

        button.classList.add(classes[selectedIndexes[0]]);
      }
    }

    // =========================
    // 近傍N駅設定の保存
    // =========================
    function refreshNearest() {
      // スライダーは最大12まで表示。
      // ＋ボタンによる12超過は基本数として維持する。
      slider.value = Math.min(12, nearestBaseCount);

      countValue.textContent = nearestBaseCount;
      totalValue.textContent = `${getNearestCount()}駅`;

      updateNearestCountButton();

      minusButton.disabled = nearestForce30 || nearestBaseCount <= 1;
      plusButton.disabled = nearestForce30;
      slider.disabled = nearestForce30;

      bonusButtons.forEach((button, index) => {
        const bonus = nearestBonuses[index];

        button.disabled = nearestForce30;
        button.classList.toggle("selected", bonus.selected);
        button.setAttribute("aria-pressed", String(bonus.selected));
      });

      force30Button.classList.toggle("active", nearestForce30);
      force30Button.textContent = nearestForce30
        ? "駅奪取ブースター 30駅固定 解除"
        : "駅奪取ブースター 30駅固定";

      // 設定を保存
      saveNearestSettings();

      // 最後に表示した地点を再計算
      if (lastNearestPoint) {
        showNearest(lastNearestPoint);
      }
    }

    // スライダー操作
    slider.addEventListener("input", () => {
      nearestBaseCount = Number(slider.value);
      refreshNearest();
    });

    // 1駅ずつ減らす（下限1）
    minusButton.addEventListener("click", () => {
      if (nearestForce30) return;

      nearestBaseCount = Math.max(1, nearestBaseCount - 1);
      refreshNearest();
    });

    // 1駅ずつ増やす（12を超えても増加可能）
    plusButton.addEventListener("click", () => {
      if (nearestForce30) return;

      nearestBaseCount++;
      refreshNearest();
    });

    // 加算ボタンは複数選択可能
    bonusButtons.forEach((button, index) => {
      button.addEventListener("click", () => {
        if (nearestForce30) return;

        nearestBonuses[index].selected =
          !nearestBonuses[index].selected;

        refreshNearest();
      });
    });

    // 30駅固定のON/OFF
    force30Button.addEventListener("click", () => {
      nearestForce30 = !nearestForce30;
      refreshNearest();
    });

    refreshNearest();
  }

  function clearNearestPoint() {
    lastNearestPoint = null;
  }

  initNearestCountControls();

  return {
    load,
    showNearest,
    calculateNearest,
    initNearestModeToggle,
    getNearestRankColor,
    clearNearestPoint,

    get count() { return stations.length; }
  };
})();

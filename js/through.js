// through.js
window.AppThrough = (() => {
  const SAMPLE_INTERVAL_METERS = 10;

  // 一時的な除外設定
  let excludeTunnelCovered = false;
  let excludeAircraftOverSpeed = false;

  // 最後に実行した集計結果をメモリ上に保持
  let lastResult = null;

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

  // Leafletの座標を通常のデータとして保存
  function copyPoint(point) {
    return {
      lat: point.lat,
      lng: point.lng
    };
  }

  // ポリラインを約10m間隔でサンプリング
  function samplePolyline(coordinates) {
    if (!coordinates || coordinates.length === 0) {
      return [];
    }

    const points = coordinates.map(([lat, lng]) =>
      L.latLng(lat, lng)
    );

    if (points.length === 1) {
      return [copyPoint(points[0])];
    }

    const samples = [copyPoint(points[0])];

    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1];
      const end = points[i];

      const distance = start.distanceTo(end);

      if (!Number.isFinite(distance) || distance <= 0) {
        continue;
      }

      // 各区間内の間隔が10m以下になるよう分割
      const steps = Math.ceil(
        distance / SAMPLE_INTERVAL_METERS
      );

      for (let step = 1; step <= steps; step++) {
        const ratio = step / steps;

        const point = L.latLng(
          start.lat + (end.lat - start.lat) * ratio,
          start.lng + (end.lng - start.lng) * ratio
        );

        const previous = samples[samples.length - 1];

        // 同じ座標の重複を避ける
        if (
          previous.lat === point.lat &&
          previous.lng === point.lng
        ) {
          continue;
        }

        samples.push(copyPoint(point));
      }
    }

    return samples;
  }

  // Overpass統合路線のサンプリング
  // トンネル・覆道の線分を除外する
  function sampleOverpassRoute(section) {

    const coordinates = section.coordinates || [];
    const segmentFlags = section.segmentFlags || [];

    if (coordinates.length < 2) return [];

    const samples = [];

    for (let i = 1; i < coordinates.length; i++) {

      // トンネル・覆道の線分は除外
      if (segmentFlags[i - 1]?.isTunnelOrCovered) {
        continue;
      }

      const segmentSamples = samplePolyline([
        coordinates[i - 1],
        coordinates[i]
      ]);

      for (const point of segmentSamples) {

        const previous = samples[samples.length - 1];

        if (
          previous &&
          previous.lat === point.lat &&
          previous.lng === point.lng
        ) {
          continue;
        }

        samples.push(point);
      }
    }

    return samples;
  }

  // Aircraftの軌跡をサンプリング
  // 900km/h以上の速度を持つ点に接する線分は除外する
  function sampleAircraftTrack(trackPoints) {
    if (!trackPoints || trackPoints.length === 0) return [];

    // 速度不明の点は除外せず、通常の点として扱う
    function isOverSpeed(point) {
      return Number.isFinite(point.speed) && point.speed >= 900;
    }

    const samples = [];

    for (let i = 1; i < trackPoints.length; i++) {
      const start = trackPoints[i - 1];
      const end = trackPoints[i];

      // どちらかの端点が900km/h以上なら、この線分を除外
      if (isOverSpeed(start) || isOverSpeed(end)) {
        continue;
      }

      // 有効な線分だけを独立してサンプリングする
      const segmentSamples = samplePolyline([
        [start.lat, start.lng],
        [end.lat, end.lng]
      ]);

      for (const point of segmentSamples) {
        const previous = samples[samples.length - 1];

        // 連続する線分の接続点など、同じ座標の重複を防ぐ
        if (
          previous &&
          previous.lat === point.lat &&
          previous.lng === point.lng
        ) {
          continue;
        }

        samples.push(point);
      }
    }

    return samples;
  }

  // 最近傍駅の情報を登録する。同じ駅は最初の出現を保持
  function addNearestStation(map, station, sourcePoint, sampleIndex) {
    const key = getStationKey(station);

    if (map.has(key)) {
      return;
    }

    map.set(key, {
      ...station,
      stationKey: key,
      rank: 1,
      sourcePoint: copyPoint(sourcePoint),
      sourceType: "polyline",
      sampleIndex
    });
  }

  // 近傍駅を集計。駅ごとに最小順位を採用
  function addNearbyStation(
    map,
    station,
    rank,
    sourcePoint,
    sourceType,
    sampleIndex
  ) {
    const key = getStationKey(station);
    const existing = map.get(key);

    if (!existing || rank < existing.rank) {
      map.set(key, {
        ...station,
        stationKey: key,
        rank,
        sourcePoint: copyPoint(sourcePoint),
        sourceType,
        sampleIndex
      });
    }
  }

  // 1つのポリライン区間を集計
  async function analyzeSection(section, options = {}) {
    const startedAt = performance.now();
    const stationApi = window.AppStations;

    if (!stationApi) {
      throw new Error("AppStations が見つかりません。");
    }

    if (typeof stationApi.calculateNearest !== "function") {
      throw new Error("AppStations.calculateNearest() が公開されていません。");
    }

    // 通常のOverpass section全体を除外
    // 統合ルートはsegmentFlagsで線分ごとに判定する
    if (
      excludeTunnelCovered &&
      section.isTunnelOrCovered === true &&
      !Array.isArray(section.segmentFlags)
    ) {
      const result = {
        sectionNumber: section.number,
        sampleIntervalMeters: SAMPLE_INTERVAL_METERS,
        samples: [],
        nearestStations: [],
        nearbyStations: [],
        stationCoordinateResults: [],
        sampleCount: 0,
        excluded: true,
        excludeReason: "トンネル・覆道",
        elapsedMs: performance.now() - startedAt
      };

      lastResult = result;
      return result;
    }

    console.log("[Through 集計対象]", {
      isTunnelOrCovered: section.isTunnelOrCovered,
      hasSegmentFlags: Array.isArray(section.segmentFlags),
      coordinateCount: section.coordinates?.length,
      segmentFlagCount: section.segmentFlags?.length,
      tunnelSegmentCount: section.segmentFlags?.filter(
        flag => flag.isTunnelOrCovered
      ).length,
      excludeTunnelCovered
    });

    let samples;

    // Overpassの上下線統合データ
    if (
      excludeTunnelCovered &&
      Array.isArray(section.segmentFlags)
    ) {
      samples = sampleOverpassRoute(section);

      // Aircraft
    } else if (
      excludeAircraftOverSpeed &&
      Array.isArray(section.trackPoints)
    ) {
      samples = sampleAircraftTrack(section.trackPoints);

      // 通常のsection
    } else {
      samples = samplePolyline(section.coordinates);
    }

    if (samples.length === 0) {
      throw new Error(
        "除外条件を適用した結果、サンプリング対象の座標がありません"
      );
    }

    const nearestMap = new Map();
    const nearbyMap = new Map();

    // サンプリング座標ごとに近傍N駅を計算
    for (let i = 0; i < samples.length; i++) {
      const point = samples[i];

      if (options.onProgress) {
        options.onProgress(i + 1, samples.length);
      }

      const candidates = stationApi.calculateNearest(
        L.latLng(point.lat, point.lng)
      );

      if (!candidates.length) {
        continue;
      }

      // 各座標の最近傍駅を記録
      addNearestStation(
        nearestMap,
        candidates[0],
        point,
        i
      );

      // 近傍N駅を順位付きで集計
      candidates.forEach((station, index) => {
        const rank = index + 1;

        const coloredStation = {
          ...station,
          rankColor: stationApi.getNearestRankColor(index)
        };

        addNearbyStation(
          nearbyMap,
          coloredStation,
          rank,
          point,
          "polyline",
          i
        );
      });
    }

    // 最近傍駅として登場した駅は近傍駅一覧から除外
    for (const key of nearestMap.keys()) {
      nearbyMap.delete(key);
    }

    // 保存したすべての最近傍駅の駅座標から、もう一度近傍N駅を計算
    const stationCoordinateResults = [];

    for (const nearestStation of nearestMap.values()) {
      const stationPoint = L.latLng(
        nearestStation.lat,
        nearestStation.lng
      );

      const candidates = stationApi.calculateNearest(stationPoint);

      candidates.forEach((station, index) => {
        const key = getStationKey(station);

        // 最近傍駅そのものは追加しない
        if (nearestMap.has(key)) {
          return;
        }

        // すでに近傍駅として登場した駅も追加しない
        if (nearbyMap.has(key)) {
          return;
        }

        const result = {
          ...station,
          stationKey: key,
          rank: index + 1,
          rankColor: stationApi.getNearestRankColor(index),
          sourcePoint: copyPoint(stationPoint),
          sourceType: "nearest-station",
          sourceStationKey: getStationKey(nearestStation),
          sourceStationName: nearestStation.name
        };

        nearbyMap.set(key, result);
        stationCoordinateResults.push(result);
      });
    }

    const result = {
      sectionNumber: section.number,
      sampleIntervalMeters: SAMPLE_INTERVAL_METERS,
      samples,
      nearestStations: [...nearestMap.values()],
      nearbyStations: [...nearbyMap.values()],
      stationCoordinateResults,
      sampleCount: samples.length,
      elapsedMs: performance.now() - startedAt
    };

    lastResult = result;

    return result;
  }

  // 現在保持している結果を取得
  function getResult() {
    return lastResult;
  }

  // 結果を破棄
  function clearResult() {
    lastResult = null;
  }

  // 除外設定
  function setExcludeTunnelCovered(value) {
    excludeTunnelCovered = Boolean(value);
  }

  function setExcludeAircraftOverSpeed(value) {
    excludeAircraftOverSpeed = Boolean(value);
  }

  function getExcludeSettings() {
    return {
      excludeTunnelCovered,
      excludeAircraftOverSpeed
    };
  }

  return {
    analyzeSection,
    samplePolyline,
    getResult,
    clearResult,

    // 除外設定
    setExcludeTunnelCovered,
    setExcludeAircraftOverSpeed,
    getExcludeSettings
  };
})();
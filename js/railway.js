// 路線データの復元。地図表示範囲と交差する区間だけを描画する。
"use strict";

window.AppRailway = (() => {
  const linesById = new Map();
  let selectedLineId = null;
  let selectedSectionNumber = null;
  let reconstructedRouteMode = false;
  let reconstructedRouteSectionNumbers = new Set();
  let loadedLineCount = 0;
  let loadedSectionCount = 0;
  let loadedPointCount = 0;
  let routeResultPromise = null;

  function numberedIcon(type, number) {
    return L.divIcon({
      className: "",
      html: `<div class="endpoint-icon ${type}">${number}</div>`,
      iconSize: [38, 24],
      iconAnchor: [19, 12]
    });
  }

  function setMarkerIcons(section, numbered) {
    section.startMarker.setIcon(
      numbered
        ? numberedIcon("start-icon", `S${section.number}`)
        : AppMap.startIcon
    );
    section.endMarker.setIcon(
      numbered
        ? numberedIcon("end-icon", `E${section.number}`)
        : AppMap.endIcon
    );
  }

  // 選択中の路線を強調する白い下地レイヤー
  const selectionHighlightPane = AppMap.map.createPane("selectionHighlightPane");
  selectionHighlightPane.style.zIndex = 410;
  selectionHighlightPane.style.pointerEvents = "none";
  const selectionHighlightLayer = L.layerGroup().addTo(AppMap.map);

  // 選択中の路線ラインを最前面に表示するレイヤー
  const selectedRailwayPane = AppMap.map.createPane("selectedRailwayPane");
  selectedRailwayPane.style.zIndex = 420;
  selectedRailwayPane.style.pointerEvents = "none";
  const selectedRailwayLayer = L.layerGroup().addTo(AppMap.map);

  // 選択対象のセクションを取得する
  function getSelectedSections() {
    if (selectedLineId === null) return [];

    const line = [...linesById.values()].find(
      item => String(item.id) === String(selectedLineId)
    );

    if (!line) return [];

    let sections = line.sections;

    if (reconstructedRouteMode) {
      sections = sections.filter(section =>
        reconstructedRouteSectionNumbers.has(Number(section.number))
      );
    } else if (selectedSectionNumber !== null) {
      sections = sections.filter(section =>
        Number(section.number) === Number(selectedSectionNumber)
      );
    }

    return sections;
  }

  // 選択中の路線・セクション・上下線を白い太線で強調
  function refreshSelectionHighlight() {
    selectionHighlightLayer.clearLayers();

    const targetSections = getSelectedSections();

    for (const section of targetSections) {
      // Aircraftは速度別の色分けを維持するため対象外
      if (section.isAircraft) continue;

      if (
        !section.polyline ||
        typeof section.polyline.getLatLngs !== "function"
      ) continue;

      const latlngs = section.polyline.getLatLngs();
      if (!latlngs || latlngs.length === 0) continue;

      const highlight = L.polyline(latlngs, {
        pane: "selectionHighlightPane",
        color: "#ffffff",
        weight: 8,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
        interactive: false
      });

      selectionHighlightLayer.addLayer(highlight);
    }
  }

  function activeSections() {

    // 設定OFFなら全路線・全セクションを表示
    if (!AppMap.isHideVoronoiOnRouteSelect()) {
      return [...linesById.values()].flatMap(line => line.sections);
    }

    // 以下は従来の路線選択時の動作
    if (selectedLineId !== null) {
      const line = linesById.get(selectedLineId);
      if (!line) return [];

      // 上下線表示中は選択セクションによる絞り込みを解除
      if (reconstructedRouteMode) {
        return line.sections;
      }

      return selectedSectionNumber === null
        ? line.sections
        : line.sections.filter(
          s => s.number === selectedSectionNumber
        );
    }

    return [...linesById.values()].flatMap(line => line.sections);
  }

  function refreshVisibleLayers() {
    const bounds = AppMap.map.getBounds();

    AppMap.railwayLayer.clearLayers();
    AppMap.startLayer.clearLayers();
    AppMap.endLayer.clearLayers();

    selectedRailwayLayer.clearLayers();

    // 選択中の路線を白い太線で強調
    refreshSelectionHighlight();

    const selectedSections = new Set(getSelectedSections());

    for (const section of activeSections()) {

      if (
        AppMap.isHideVoronoiOnRouteSelect() &&
        reconstructedRouteMode &&
        !reconstructedRouteSectionNumbers.has(Number(section.number))
      ) {
        continue;
      }

      if (!section.bounds.intersects(bounds)) continue;

      // 通常の路線レイヤー
      AppMap.railwayLayer.addLayer(section.polyline);

      // 選択対象の路線は、さらに上のPaneにも描画
      if (selectedSections.has(section)) {
        const original = section.polyline;

        if (typeof original.getLatLngs === "function") {

          // 通常路線
          const selectedPolyline = L.polyline(
            original.getLatLngs(),
            {
              ...original.options,
              pane: "selectedRailwayPane",
              interactive: false
            }
          );

          selectedRailwayLayer.addLayer(selectedPolyline);

        } else if (typeof original.eachLayer === "function") {

          // AircraftなどのLayerGroup
          original.eachLayer(child => {
            if (typeof child.getLatLngs !== "function") return;

            const selectedPolyline = L.polyline(
              child.getLatLngs(),
              {
                ...child.options,
                pane: "selectedRailwayPane",
                interactive: false
              }
            );

            selectedRailwayLayer.addLayer(selectedPolyline);
          });
        }
      }

      if (bounds.contains(section.startMarker.getLatLng())) {
        AppMap.startLayer.addLayer(section.startMarker);
      }

      if (bounds.contains(section.endMarker.getLatLng())) {
        AppMap.endLayer.addLayer(section.endMarker);
      }
    }
  }

  function setReconstructedRouteMode(enabled) {
    reconstructedRouteMode = enabled;
    // 元のセクションレイヤーを更新
    refreshVisibleLayers();
  }

  function showReconstructedRouteSections(entries) {
    reconstructedRouteMode = true;
    reconstructedRouteSectionNumbers = new Set();

    for (const entry of entries) {
      for (const item of entry.sections || []) {
        const section = item.section;

        if (section) {
          reconstructedRouteSectionNumbers.add(
            Number(section.number)
          );
        } else if (item.sectionNumber != null) {
          reconstructedRouteSectionNumbers.add(
            Number(item.sectionNumber)
          );
        }
      }
    }

    console.log("[Route] 表示対象セクション", {
      count: reconstructedRouteSectionNumbers.size,
      sections: [...reconstructedRouteSectionNumbers]
    });

    // 対象セクションを表示
    refreshVisibleLayers();

    // =========================
    // 表示対象にカメラを合わせる
    // =========================
    const line = linesById.get(String(selectedLineId));
    if (!line) return;

    const targetSections = line.sections.filter(section =>
      reconstructedRouteSectionNumbers.has(Number(section.number))
    );

    if (targetSections.length === 0) return;

    const bounds = L.latLngBounds(
      targetSections.flatMap(section => section.coordinates)
    );

    if (bounds.isValid()) {
      AppMap.map.fitBounds(bounds, {
        padding: [45, 45],
        maxZoom: 14
      });
    }
  }


  function selectLine(lineId) {

    // 近傍駅モードの表示を解除
    AppMap.clearNearestStations();

    const line = linesById.get(String(lineId));

    if (!line) return;

    // 前の路線の解析結果を破棄
    routeResultPromise = null;

    selectedLineId = String(lineId);

    if (line.isOverpass) {
      const result =
        window.PolylineSorter.analyzeOverpassConnections(line);

      console.log("[Overpass] 接続解析結果", result);
    }

    // ポリライン接続診断（S1〜S7）
    if (!line.isAircraft && window.PolylineSorter?.diagnoseJunctions) {
      console.log(
        `[PolylineSorter] 接続診断開始: ${line.name || line.id || lineId}`
      );

      window.PolylineSorter.diagnoseJunctions(
        line,
        [1, 2, 3, 4, 5, 6, 7]
      );
    }

    // Overpassの場合は専用処理を使用
    if (line.isOverpass) {

      console.log("[Overpass] 経路復元開始:", line.name);

      const result = window.PolylineSorter.reconstructOverpassRoutes(line);
      console.log(
        "[Overpass] section structure",
        result.routes.map((route, index) => ({
          routeIndex: index,
          firstSection: route.sections?.[0],
          secondSection: route.sections?.[1],
          sectionCount: route.sections?.length
        }))
      );

      // details.js の既存処理から参照するために必要
      routeResultPromise = Promise.resolve(result);

    } else {
      // Aircraftは読み込み済みの座標を使用するため、
      // 外部の路線JSON取得・経路復元を行わない
      if (!line.isAircraft) {

        // 経路復元結果を取得・キャッシュ
        (async () => {
          try {
            if (!window.PolylineSorter?.reconstructRoutes) {
              throw new Error(
                "PolylineSorter.reconstructRoutes が読み込まれていません。"
              );
            }

            const stationData = await AppData.fetchJson(
              `./line/${encodeURIComponent(line.id)}.json`
            );

            // 経路復元は路線選択時に1回だけ実行
            const result = window.PolylineSorter.reconstructRoutes(
              line,
              stationData
            );

            // details.js から参照できるように保存
            routeResultPromise = Promise.resolve(result);

            console.log("[PolylineSorter] 経路復元完了", result);
          } catch (error) {
            routeResultPromise = null;

            console.error(
              "[PolylineSorter] 経路復元に失敗しました",
              error
            );
          }
        })();
      }
    }

    selectedSectionNumber = null;
    document.body.classList.remove("section-focus");
    AppMap.setRouteMode(true);
    for (const section of line.sections) setMarkerIcons(section, true);
    AppDetails.showRailway(line);
    const bounds = L.latLngBounds(
      line.sections.flatMap(section => section.coordinates)
    );

    if (bounds.isValid()) {
      AppMap.map.fitBounds(bounds, {
        padding: [35, 35],
        maxZoom: 13
      });
    }
    refreshVisibleLayers();
  }

  // 駅情報カードからの路線選択イベント
  window.addEventListener("select-railway-line", event => {
    const lineCode = event.detail?.lineCode;
    if (lineCode == null) return;

    // station.json の lines に格納されているコードと路線情報を照合
    const line = [...linesById.values()].find(item =>
      String(item.code) === String(lineCode) ||
      String(item.id) === String(lineCode)
    );

    if (!line) {
      console.warn("[Railway] 路線が見つかりません:", lineCode);
      return;
    }

    // linesById のキーを確認して selectLine に渡す
    const lineId = linesById.has(String(line.id))
      ? line.id
      : line.code;

    selectLine(lineId);
  });

  function showSection(lineId, sectionNumber) {
    const line = linesById.get(String(lineId));
    if (!line) return;
    const section = line.sections.find(item => item.number === Number(sectionNumber));
    if (!section) return;
    selectedLineId = String(lineId);
    selectedSectionNumber = Number(sectionNumber);
    document.body.classList.add("section-focus");
    for (const item of line.sections) setMarkerIcons(item, true);
    AppMap.setRouteMode(true);
    AppMap.map.fitBounds(section.bounds, { padding: [45, 45], maxZoom: 16 });
    refreshVisibleLayers();
  }
  function clearSelection() {
    selectedLineId = null;
    selectedSectionNumber = null;

    reconstructedRouteMode = false;
    reconstructedRouteSectionNumbers.clear();

    document.body.classList.remove("section-focus");

    for (const line of linesById.values()) {
      for (const section of line.sections) {
        setMarkerIcons(section, false);
      }
    }

    AppMap.setRouteMode(false);
    refreshVisibleLayers();
    AppDetails.showEmpty();
  }

  function getRouteResultPromise() {
    return routeResultPromise;
  }

  async function load() {
    const data = await AppData.fetchJson("./line.json");

    if (!Array.isArray(data)) {
      throw new Error("line.json が配列形式ではありません");
    }

    // 路線ごとの GeoJSON を並列読み込み
    const results = await Promise.allSettled(
      data.map(async rawLine => {
        if (
          rawLine.code == null ||
          typeof rawLine.name !== "string"
        ) {
          throw new Error("line.json の路線データが不正です");
        }

        const id = String(rawLine.code);
        const name = rawLine.name;
        const color =
          typeof rawLine.color === "string" &&
            /^#[0-9a-fA-F]{6}$/.test(rawLine.color)
            ? rawLine.color
            : "#666666";

        const url = `./polyline/${encodeURIComponent(id)}.json`;
        let geojson;
        try {
          geojson = await AppData.fetchJson(url);
        } catch (error) {
          if (error.status === 404) {
            console.warn(
              `polyline データなしのためスキップ: ${name} (code: ${id})`
            );
            return null;
          }
          throw error;
        }

        if (
          geojson.type !== "FeatureCollection" ||
          !Array.isArray(geojson.features)
        ) {
          throw new Error(`${url}: GeoJSON の形式が不正です`);
        }

        const line = {
          id,
          name,
          color,
          sections: [],
          pointCount: 0
        };

        geojson.features.forEach((feature, index) => {
          if (
            feature?.geometry?.type !== "LineString" ||
            !Array.isArray(feature.geometry.coordinates)
          ) {
            return;
          }

          const coordinates = feature.geometry.coordinates
            .filter(coord =>
              Array.isArray(coord) &&
              coord.length >= 2 &&
              Number.isFinite(coord[0]) &&
              Number.isFinite(coord[1]) &&
              Math.abs(coord[0]) <= 180 &&
              Math.abs(coord[1]) <= 90
            )
            .map(coord => [coord[1], coord[0]]);

          if (coordinates.length < 2) return;

          const number = index + 1;
          const props = feature.properties || {};


          const section = {
            number,
            coordinates,
            bounds: L.latLngBounds(coordinates),
            start: coordinates[0],
            end: coordinates[coordinates.length - 1],

            // 元の地点名を保持
            startName:
              typeof props.start === "string" ? props.start : null,
            endName:
              typeof props.end === "string" ? props.end : null,

            // 元データの properties も保持
            properties: { ...props },

            lineId: id,
            lineName: name
          };


          const polyline = L.polyline(coordinates, {
            color,
            weight: 3,
            opacity: 0.9,
            bubblingMouseEvents: false
          });

          polyline.bindTooltip(
            `${AppMap.escapeHtml(name)}（区間 ${number}）`
          );

          polyline.bindPopup(
            `<b>${AppMap.escapeHtml(name)}</b>` +
            `<br>路線 ID: ${AppMap.escapeHtml(id)}` +
            `<br>区間: ${number}` +
            `<br>座標数: ${coordinates.length}`
          );

          polyline.on("click", () => selectLine(id));

          const startMarker = L.marker(section.start, {
            icon: AppMap.startIcon,
            title: `${name} 区間 ${number} 開始位置`
          });

          startMarker._stationSection = section;
          startMarker.bindPopup(
            `<b>${AppMap.escapeHtml(name)}</b>` +
            `<br>区間: ${number}` +
            `<br>開始位置` +
            `<br>緯度: ${section.start[0].toFixed(6)}` +
            `<br>経度: ${section.start[1].toFixed(6)}`
          );
          startMarker.on("click", () => selectLine(id));

          const endMarker = L.marker(section.end, {
            icon: AppMap.endIcon,
            title: `${name} 区間 ${number} 終了位置`
          });

          endMarker._stationSection = section;
          endMarker.bindPopup(
            `<b>${AppMap.escapeHtml(name)}</b>` +
            `<br>区間: ${number}` +
            `<br>終了位置` +
            `<br>緯度: ${section.end[0].toFixed(6)}` +
            `<br>経度: ${section.end[1].toFixed(6)}`
          );
          endMarker.on("click", () => selectLine(id));

          section.polyline = polyline;
          section.startMarker = startMarker;
          section.endMarker = endMarker;

          line.sections.push(section);
          line.pointCount += coordinates.length;
        });

        return line;
      })
    );

    // 読み込み結果を反映
    linesById.clear();
    loadedLineCount = 0;
    loadedSectionCount = 0;
    loadedPointCount = 0;

    let errorCount = 0;

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        errorCount++;
        console.error(
          `路線データ読み込み失敗 (${data[index]?.code ?? "?"}):`,
          result.reason
        );
        return;
      }

      const line = result.value;

      // polyline ファイルが存在しない路線はスキップ
      // 嘉手納線（99929）と鉄道院中央本線（99349）
      if (line === null) return;

      if (line.sections.length === 0) return;

      linesById.set(line.id, line);
      loadedLineCount++;
      loadedSectionCount += line.sections.length;
      loadedPointCount += line.pointCount;
    });

    clearSelection();

    AppMap.setStatus(
      "lines-status",
      `路線: ${loadedLineCount.toLocaleString()}` +
      ` / 区間: ${loadedSectionCount.toLocaleString()}` +
      ` / 座標: ${loadedPointCount.toLocaleString()}` +
      `（表示範囲内のみ描画）` +
      (errorCount ? ` / 読み込み失敗: ${errorCount}` : "")
    );

    console.log(
      "Loaded lines:",
      loadedLineCount,
      "sections:",
      loadedSectionCount,
      "coordinates:",
      loadedPointCount,
      "errors:",
      errorCount
    );
  }



  let gpxSequence = 0;

  async function addGpxFile(file) {
    const xmlText = await file.text();
    const xml = new DOMParser().parseFromString(
      xmlText,
      "application/xml"
    );

    if (
      xml.getElementsByTagName("parsererror").length > 0 ||
      !xml.documentElement ||
      xml.documentElement.localName !== "gpx"
    ) {
      throw new Error(`${file.name}: GPX の XML 形式が不正です`);
    }

    const GPX_NS = "http://www.topografix.com/GPX/1/1";

    function children(element, name) {
      return Array.from(element.children)
        .filter(child => child.localName === name);
    }

    function childText(element, name) {
      return children(element, name)[0]?.textContent?.trim() ?? "";
    }

    // 名前空間付き GPX を優先し、名前空間なしも許容
    function getTracks() {
      const tracks = xml.getElementsByTagNameNS(GPX_NS, "trk");

      if (tracks.length > 0) {
        return Array.from(tracks);
      }

      return Array.from(xml.getElementsByTagName("trk"));
    }

    const tracks = getTracks();

    if (tracks.length === 0) {
      throw new Error(`${file.name}: trk が見つかりません`);
    }

    const addedLines = [];

    tracks.forEach((track, trackIndex) => {
      const trackName =
        childText(track, "name") ||
        (tracks.length === 1
          ? file.name.replace(/\.gpx$/i, "")
          : `${file.name.replace(/\.gpx$/i, "")} (${trackIndex + 1})`);

      // 同じ名前の路線が存在しても区別できる ID
      const id = `gpx:${++gpxSequence}`;

      const line = {
        id,
        name: trackName,
        color: "#d32f2f",
        sections: [],
        pointCount: 0,
        isGpx: true,
        sourceFile: file.name
      };

      const segments = children(track, "trkseg");

      segments.forEach((segment, segmentIndex) => {
        const coordinates = [];
        const pointNames = [];

        children(segment, "trkpt").forEach(point => {
          const lat = Number(point.getAttribute("lat"));
          const lng = Number(point.getAttribute("lon"));

          if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat) > 90 ||
            Math.abs(lng) > 180
          ) {
            return;
          }

          coordinates.push([lat, lng]);
          pointNames.push(childText(point, "name"));
        });

        if (coordinates.length < 2) return;

        const number = segmentIndex + 1;
        const start = coordinates[0];
        const end = coordinates[coordinates.length - 1];
        const bounds = L.latLngBounds(coordinates);

        const section = {
          number,
          coordinates,
          bounds,
          start,
          end,
          startName: pointNames[0] || "",
          endName: pointNames[pointNames.length - 1] || "",
          lineId: id,
          lineName: trackName
        };

        const polyline = L.polyline(coordinates, {
          color: line.color,
          weight: 4,
          opacity: 0.95,
          bubblingMouseEvents: false
        });

        polyline.bindTooltip(
          `${AppMap.escapeHtml(trackName)}（GPX 区間 ${number}）`
        );

        polyline.bindPopup(
          `<b>${AppMap.escapeHtml(trackName)}</b>` +
          `<br>ファイル: ${AppMap.escapeHtml(file.name)}` +
          `<br>区間: ${number}` +
          `<br>座標数: ${coordinates.length}`
        );

        polyline.on("click", () => selectLine(id));

        const startMarker = L.marker(start, {
          icon: AppMap.startIcon,
          title: `${trackName} GPX 区間 ${number} 開始位置`
        });

        startMarker._stationSection = section;
        startMarker.bindPopup(
          `<b>${AppMap.escapeHtml(trackName)}</b>` +
          `<br>GPX 区間: ${number}` +
          `<br>開始位置` +
          `<br>緯度: ${start[0].toFixed(6)}` +
          `<br>経度: ${start[1].toFixed(6)}`
        );
        startMarker.on("click", () => selectLine(id));

        const endMarker = L.marker(end, {
          icon: AppMap.endIcon,
          title: `${trackName} GPX 区間 ${number} 終了位置`
        });

        endMarker._stationSection = section;
        endMarker.bindPopup(
          `<b>${AppMap.escapeHtml(trackName)}</b>` +
          `<br>GPX 区間: ${number}` +
          `<br>終了位置` +
          `<br>緯度: ${end[0].toFixed(6)}` +
          `<br>経度: ${end[1].toFixed(6)}`
        );
        endMarker.on("click", () => selectLine(id));

        section.polyline = polyline;
        section.startMarker = startMarker;
        section.endMarker = endMarker;

        line.sections.push(section);
        line.pointCount += coordinates.length;
      });

      if (line.sections.length > 0) {
        linesById.set(id, line);
        loadedLineCount++;
        loadedSectionCount += line.sections.length;
        loadedPointCount += line.pointCount;
        addedLines.push(line);
      }
    });

    if (addedLines.length === 0) {
      throw new Error(`${file.name}: 表示可能なトラック区間がありません`);
    }

    // 読み込んだ最初のトラックを選択し、詳細を表示
    selectLine(addedLines[0].id);

    AppMap.setStatus(
      "lines-status",
      `路線: ${loadedLineCount.toLocaleString()}` +
      ` / 区間: ${loadedSectionCount.toLocaleString()}` +
      ` / 座標: ${loadedPointCount.toLocaleString()}` +
      `（GPX 読み込み済み）`
    );

    console.log(
      "GPX loaded:",
      file.name,
      "tracks:",
      addedLines.length,
      "sections:",
      addedLines.reduce((sum, line) => sum + line.sections.length, 0)
    );

    return addedLines.length;
  }


  let aircraftSequence = 0;

  // 速度に応じた色を計算する。
  // 900 km/h 以上はグラデーションと区別した赤色。
  function getAircraftSpeedColor(speed) {
    if (!Number.isFinite(speed) || speed < 0) {
      speed = 0;
    }

    if (speed >= 900) {
      return "#ff0000";
    }

    speed = Math.min(speed, 899);

    const stops = [
      { speed: 0, color: [0, 0, 255] },     // 青
      { speed: 300, color: [0, 200, 83] },    // 緑
      { speed: 600, color: [255, 235, 59] },  // 黄
      { speed: 899, color: [255, 152, 0] }    // オレンジ
    ];

    let lower = stops[0];
    let upper = stops[stops.length - 1];

    for (let i = 0; i < stops.length - 1; i++) {
      if (speed >= stops[i].speed && speed <= stops[i + 1].speed) {
        lower = stops[i];
        upper = stops[i + 1];
        break;
      }
    }

    const ratio =
      (speed - lower.speed) / (upper.speed - lower.speed);

    const rgb = lower.color.map((value, index) =>
      Math.round(
        value + (upper.color[index] - value) * ratio
      )
    );

    return "#" + rgb
      .map(value => value.toString(16).padStart(2, "0"))
      .join("");
  }

  async function addAircraftFile(file) {
    const text = await file.text();

    let json;

    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("JSON の解析に失敗しました");
    }

    const flight = json?.result?.response?.data?.flight;
    const track = flight?.track;

    if (!Array.isArray(track) || track.length < 2) {
      throw new Error(
        "flight.track に有効な位置情報が2点以上ありません"
      );
    }

    const identification = flight.identification || {};
    const aircraft = flight.aircraft || {};
    const airport = flight.airport || {};

    const flightNumber =
      identification.number?.default ||
      identification.callsign ||
      identification.id ||
      file.name;

    const callsign = identification.callsign;
    const model = aircraft.model?.text || "";
    const registration =
      aircraft.identification?.registration || "";

    const origin = airport.origin?.name || "";
    const destination = airport.destination?.name || "";

    const name = callsign && callsign !== flightNumber
      ? `${flightNumber} (${callsign})`
      : String(flightNumber);

    const id = `aircraft:${++aircraftSequence}`;

    // 有効な位置情報と速度を抽出
    const points = track
      .map(point => ({
        lat: Number(point.latitude),
        lng: Number(point.longitude),
        speed: Number(point.speed?.kmh),
        timestamp: point.timestamp,
        course: point.course ?? null,
        altitude: point.altitude ?? null,
        rate: point.rate ?? "",
        reportingFacility: point.reportingFacility ?? ""
      }))
      .filter(point =>
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        Math.abs(point.lat) <= 90 &&
        Math.abs(point.lng) <= 180
      );

    if (points.length < 2) {
      throw new Error("有効な位置情報が2点未満です");
    }

    const coordinates = points.map(point => [
      point.lat,
      point.lng
    ]);

    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];
    const bounds = L.latLngBounds(coordinates);

    const line = {
      id,
      name,
      color: "#ff0000",
      sections: [],
      pointCount: coordinates.length,
      isAircraft: true,
      sourceFile: file.name,
      flightNumber,
      callsign,
      model,
      registration,
      origin,
      destination
    };

    const section = {
      number: 1,
      coordinates,
      bounds,
      start,
      end,
      lineId: id,
      lineName: name,

      // サンプリング時の速度判定用
      trackPoints: points.map(point => ({
        lat: point.lat,
        lng: point.lng,
        speed: point.speed
      }))
    };

    // 1本のポリラインではなく、隣接点ごとに色を変えた
    // 複数のポリラインを LayerGroup にまとめる。
    const coloredSegments = [];

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      const validA = Number.isFinite(a.speed) && a.speed >= 0;
      const validB = Number.isFinite(b.speed) && b.speed >= 0;

      let speed = 0;

      if (validA && validB) {
        speed = (a.speed + b.speed) / 2;
      } else if (validA) {
        speed = a.speed;
      } else if (validB) {
        speed = b.speed;
      }

      const color = getAircraftSpeedColor(speed);

      const segment = L.polyline(
        [
          [a.lat, a.lng],
          [b.lat, b.lng]
        ],
        {
          color,
          weight: 4,
          opacity: 0.95,
          bubblingMouseEvents: false
        }
      );

      segment.bindTooltip(
        `${AppMap.escapeHtml(name)}<br>${speed.toFixed(1)} km/h`
      );

      segment.bindPopup(
        `<b>${AppMap.escapeHtml(name)}</b>` +
        `<br>ファイル: ${AppMap.escapeHtml(file.name)}` +
        `<br>速度: ${speed.toFixed(1)} km/h` +
        `<br>位置: ${i + 1} → ${i + 2}`
      );

      segment.on("click", () => selectLine(id));

      coloredSegments.push(segment);
    }

    const polyline = L.layerGroup(coloredSegments);

    const startMarker = L.marker(start, {
      icon: AppMap.startIcon,
      title: `${name} 開始位置`
    });

    startMarker._stationSection = section;
    startMarker.bindPopup(
      `<b>${AppMap.escapeHtml(name)}</b>` +
      `<br>開始位置` +
      `<br>緯度: ${start[0].toFixed(6)}` +
      `<br>経度: ${start[1].toFixed(6)}`
    );
    startMarker.on("click", () => selectLine(id));

    const endMarker = L.marker(end, {
      icon: AppMap.endIcon,
      title: `${name} 終了位置`
    });

    endMarker._stationSection = section;
    endMarker.bindPopup(
      `<b>${AppMap.escapeHtml(name)}</b>` +
      `<br>終了位置` +
      `<br>緯度: ${end[0].toFixed(6)}` +
      `<br>経度: ${end[1].toFixed(6)}`
    );
    endMarker.on("click", () => selectLine(id));

    section.polyline = polyline;
    section.startMarker = startMarker;
    section.endMarker = endMarker;

    line.sections.push(section);

    linesById.set(id, line);
    loadedLineCount++;
    loadedSectionCount++;
    loadedPointCount += line.pointCount;

    // 既存の路線選択・詳細表示機能を利用
    selectLine(id);

    AppMap.setStatus(
      "lines-status",
      `路線: ${loadedLineCount.toLocaleString()}` +
      ` / 区間: ${loadedSectionCount.toLocaleString()}` +
      ` / 座標: ${loadedPointCount.toLocaleString()}` +
      `（Aircraft 読み込み済み）`
    );

    console.log("Aircraft loaded:", {
      file: file.name,
      flight: name,
      model,
      registration,
      points: points.length,
      origin,
      destination
    });

    return line;
  }

  async function addAircraftText(text) {
    const rows = text
      .split(/\r?\n/)
      .map(row => row.split("\t").map(value => value.trim()));

    // ヘッダー行を取得
    const headerIndex = rows.findIndex(row =>
      row.some(cell => cell.includes("Latitude")) &&
      row.some(cell => cell.includes("Longitude"))
    );

    if (headerIndex < 0) {
      throw new Error("Latitude / Longitude の列が見つかりません");
    }

    const headers = rows[headerIndex];

    const column = name =>
      headers.findIndex(value =>
        value.toLowerCase() === name.toLowerCase()
      );

    const timeCol = column("Time (EDT)");
    const latCol = column("Latitude");
    const lngCol = column("Longitude");
    const courseCol = column("Course");
    const speedCol = column("kts");
    const altitudeCol = column("feet");
    const rateCol = column("Rate");
    const facilityCol = column("Reporting Facility");

    if (latCol < 0 || lngCol < 0) {
      throw new Error("緯度・経度の列を特定できません");
    }

    let origin = "";
    let destination = "";

    const track = [];

    for (const row of rows.slice(headerIndex + 1)) {
      const get = index => index >= 0 ? (row[index] ?? "").trim() : "";

      // 発着空港情報
      const timeText = get(timeCol);

      const departureMatch = timeText.match(/Departure\s*\(([^)]+)\)/i);
      const arrivalMatch = timeText.match(/Arrival\s*\(([^)]+)\)/i);

      if (departureMatch) origin = departureMatch[1];
      if (arrivalMatch) destination = arrivalMatch[1];

      // 緯度・経度
      const latText = get(latCol);
      const lngText = get(lngCol);

      if (
        !/^-?\d+(?:\.\d+)?$/.test(latText) ||
        !/^-?\d+(?:\.\d+)?$/.test(lngText)
      ) {
        continue;
      }

      const lat = Number(latText);
      const lng = Number(lngText);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        continue;
      }

      // 速度：kts → km/h
      const ktsText = get(speedCol).replace(/,/g, "");
      const kts = Number(ktsText);

      const speedKmh = Number.isFinite(kts)
        ? kts * 1.852
        : null;

      // 進行方向
      const courseText = get(courseCol);
      const courseMatch = courseText.match(/(-?\d+(?:\.\d+)?)\s*°?/);
      const course = courseMatch ? Number(courseMatch[1]) : null;

      // 高度
      const altitudeText = get(altitudeCol).replace(/,/g, "");
      const altitude = Number(altitudeText);

      // 上昇・下降率
      const rateText = get(rateCol);

      track.push({
        latitude: lat,
        longitude: lng,
        timestamp: timeText,
        speed: {
          kmh: speedKmh
        },
        course,
        altitude: Number.isFinite(altitude) ? altitude : null,
        rate: rateText,
        reportingFacility: get(facilityCol)
      });
    }

    if (track.length < 2) {
      throw new Error("有効な位置情報が2点未満です");
    }

    // 既存JSON形式に変換して共通処理へ渡す
    const flight = {
      identification: {
        number: {
          default: [
            origin,
            destination
          ].filter(Boolean).join(" → ") || "Aircraft"
        }
      },
      aircraft: {},
      airport: {
        origin: origin ? { name: origin } : {},
        destination: destination ? { name: destination } : {}
      },
      track
    };

    const json = {
      result: {
        response: {
          data: {
            flight
          }
        }
      }
    };

    const file = new File(
      [JSON.stringify(json)],
      `Aircraft_${origin || "Unknown"}_${destination || "Unknown"}.json`,
      { type: "application/json" }
    );

    return addAircraftFile(file);
  }



  let overpassSequence = 0;

  // maxspeed を km/h として解釈する。
  // mph の場合は km/h に換算する。
  // signals、none などの数値でない値は null。
  function parseOverpassMaxspeed(value) {
    if (value == null) return null;

    const text = String(value).trim().toLowerCase();
    const match = text.match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kph)?$/);

    if (!match) return null;

    const speed = Number(match[1]);
    if (!Number.isFinite(speed)) return null;

    return match[2] === "mph" ? speed * 1.609344 : speed;
  }

  // 速度制限に応じた色
  function getOverpassSpeedColor(value) {
    const speed = parseOverpassMaxspeed(value);

    if (speed == null) return "#666666";
    if (speed <= 40) return "#2e7d32";
    if (speed <= 60) return "#66bb6a";
    if (speed <= 80) return "#fdd835";
    if (speed <= 100) return "#fb8c00";

    return "#e53935";
  }

  // OSM の yes/no 系タグを判定
  function isOverpassTagEnabled(value) {
    if (value == null) return false;

    return !["", "no", "false", "0"].includes(
      String(value).trim().toLowerCase()
    );
  }

  function addOverpassFile(file) {
    // async 関数として扱うため、既存の呼び出し側で await できます。
    return file.text().then(text => {
      let geojson;

      try {
        geojson = JSON.parse(text);
      } catch {
        throw new Error(`${file.name}: JSON の解析に失敗しました`);
      }

      const features = geojson?.type === "FeatureCollection"
        ? geojson.features
        : geojson?.type === "Feature"
          ? [geojson]
          : null;

      if (!Array.isArray(features)) {
        throw new Error(
          `${file.name}: Feature または FeatureCollection ではありません`
        );
      }

      const id = `overpass:${++overpassSequence}`;
      const fallbackName = file.name.replace(/\.(geojson|json)$/i, "");

      const line = {
        id,
        name: fallbackName,
        color: "#666666",
        sections: [],
        pointCount: 0,
        isOverpass: true,
        sourceFile: file.name
      };

      let sectionNumber = 0;

      features.forEach(feature => {
        const geometry = feature?.geometry;
        const props = feature?.properties || {};

        if (!geometry) return;

        // LineString と MultiLineString の両方に対応
        let coordinateLines = [];

        if (geometry.type === "LineString") {
          coordinateLines = [geometry.coordinates];
        } else if (geometry.type === "MultiLineString") {
          coordinateLines = geometry.coordinates;
        } else {
          return;
        }

        coordinateLines.forEach(rawCoordinates => {
          if (!Array.isArray(rawCoordinates)) return;

          const coordinates = rawCoordinates
            .filter(coord =>
              Array.isArray(coord) &&
              coord.length >= 2 &&
              Number.isFinite(coord[0]) &&
              Number.isFinite(coord[1]) &&
              Math.abs(coord[0]) <= 180 &&
              Math.abs(coord[1]) <= 90
            )
            .map(coord => [coord[1], coord[0]]);

          if (coordinates.length < 2) return;

          const number = ++sectionNumber;
          const start = coordinates[0];
          const end = coordinates[coordinates.length - 1];

          const section = {
            number,
            coordinates,
            bounds: L.latLngBounds(coordinates),
            start,
            end,
            lineId: id,
            lineName: props["name:ja"] || props.name || fallbackName,
            properties: { ...props },

            // トンネル・覆道情報
            isTunnelOrCovered:
              isOverpassTagEnabled(props.tunnel) ||
              isOverpassTagEnabled(props.covered)
          };

          const maxspeed = props.maxspeed;
          const color = maxspeed != null
            ? getOverpassSpeedColor(maxspeed)
            : line.color;

          const translucent =
            isOverpassTagEnabled(props.tunnel) ||
            isOverpassTagEnabled(props.covered);

          const polyline = L.polyline(coordinates, {
            color,
            weight: 4,
            opacity: translucent ? 0.35 : 1,
            bubblingMouseEvents: false
          });

          const sectionName = section.lineName;

          polyline.bindTooltip(
            `${AppMap.escapeHtml(sectionName)}（区間 ${number}）`
          );

          polyline.bindPopup(
            `<b>${AppMap.escapeHtml(sectionName)}</b>` +
            `<br>ファイル: ${AppMap.escapeHtml(file.name)}` +
            `<br>区間: ${number}` +
            `<br>路線 ID: ${AppMap.escapeHtml(id)}` +
            (maxspeed != null
              ? `<br>最高速度: ${AppMap.escapeHtml(maxspeed)}`
              : "") +
            (translucent ? "<br>トンネル・覆道: 半透明表示" : "")
          );

          polyline.on("click", () => selectLine(id));

          const startMarker = L.marker(start, {
            icon: AppMap.startIcon,
            title: `${sectionName} 区間 ${number} 開始位置`
          });

          startMarker._stationSection = section;
          startMarker.bindPopup(
            `<b>${AppMap.escapeHtml(sectionName)}</b>` +
            `<br>区間: ${number}` +
            `<br>開始位置` +
            `<br>緯度: ${start[0].toFixed(6)}` +
            `<br>経度: ${start[1].toFixed(6)}`
          );
          startMarker.on("click", () => selectLine(id));

          const endMarker = L.marker(end, {
            icon: AppMap.endIcon,
            title: `${sectionName} 区間 ${number} 終了位置`
          });

          endMarker._stationSection = section;
          endMarker.bindPopup(
            `<b>${AppMap.escapeHtml(sectionName)}</b>` +
            `<br>区間: ${number}` +
            `<br>終了位置` +
            `<br>緯度: ${end[0].toFixed(6)}` +
            `<br>経度: ${end[1].toFixed(6)}`
          );
          endMarker.on("click", () => selectLine(id));

          section.polyline = polyline;
          section.startMarker = startMarker;
          section.endMarker = endMarker;

          line.sections.push(section);
          line.pointCount += coordinates.length;
        });
      });

      if (line.sections.length === 0) {
        throw new Error(
          `${file.name}: 表示可能な LineString がありません`
        );
      }

      // 名前は最初の区間の属性を優先する
      line.name = line.sections[0].lineName;

      // 既存の路線管理・詳細パネルに登録
      linesById.set(id, line);
      loadedLineCount++;
      loadedSectionCount += line.sections.length;
      loadedPointCount += line.pointCount;

      selectLine(id);

      AppMap.setStatus(
        "lines-status",
        `路線: ${loadedLineCount.toLocaleString()}` +
        ` / 区間: ${loadedSectionCount.toLocaleString()}` +
        ` / 座標: ${loadedPointCount.toLocaleString()}` +
        `（Overpass GeoJSON 読み込み済み）`
      );

      console.log("Overpass GeoJSON loaded:", {
        file: file.name,
        sections: line.sections.length,
        points: line.pointCount
      });

      return line;
    });
  }


  return {
    load,
    addGpxFile,
    addAircraftFile,
    addAircraftText,
    addOverpassFile,
    selectLine,
    showSection,
    clearSelection,
    getRouteResultPromise,
    refreshVisibleLayers,
    setReconstructedRouteMode,
    showReconstructedRouteSections,

    get selectedLineId() { return selectedLineId; },
    get selectedSectionNumber() { return selectedSectionNumber; }
  };
})();

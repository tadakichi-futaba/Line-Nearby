// 左側詳細情報パネル
"use strict";

window.AppDetails = (() => {
  const content = document.getElementById("details-content");
  let throughHoverMarker = null;
  let throughHoverLine = null;

  function clearThroughHover() {
    if (throughHoverMarker) {
      throughHoverMarker.remove();
      throughHoverMarker = null;
    }

    if (throughHoverLine) {
      throughHoverLine.remove();
      throughHoverLine = null;
    }
  }

  function escapeHtml(value) {
    return AppMap.escapeHtml(String(value));
  }

  function coordinateRows(label, point) {
    return `<div class="coordinate-row"><span class="coordinate-label">${label}</span><span class="coordinate-value">${point[0].toFixed(6)}, ${point[1].toFixed(6)}</span></div>`;
  }

  function showNearest(clickPoint, stations, mode = 'flat') {

    // =========================
    // 最近傍駅カード（1位）
    // =========================
    const firstStation = stations[0];

    const primaryCard = firstStation ? `
      <div class="nearest-primary-card">

        <div class="nearest-primary-header">
          <div class="nearest-primary-kana">
            ${escapeHtml(firstStation.nameKana || "")}
          </div>
        </div>

        <div class="nearest-primary-main">

          <div class="nearest-primary-info">
            <div class="nearest-primary-name">
              ${escapeHtml(firstStation.name)}
            </div>

            <div class="nearest-primary-prefecture">
              ${escapeHtml(firstStation.prefectureName || "都道府県不明")}
            </div>
          </div>

          <div class="nearest-primary-status">
            <div class="nearest-distance-attr">
              <span class="nearest-distance">
                ${firstStation.distance >= 1000
        ? (firstStation.distance / 1000).toFixed(2) + " km"
        : Math.round(firstStation.distance) + " m"
      }
              </span>

              <span class="nearest-attr attr-${escapeHtml(firstStation.attr || "unknown")}">
                ${escapeHtml(firstStation.attr || "unknown")}
              </span>
            </div>

            <span class="nearest-coordinate">
              ${firstStation.lat.toFixed(5)}, ${firstStation.lng.toFixed(5)}
            </span>
          </div>

        </div>

        <div class="nearest-primary-lines">
          ${(firstStation.lines || []).map(line => `
            <div class="nearest-primary-line"
                data-line-code="${escapeHtml(line.code)}"
                role="button"
                tabindex="0">
              <span class="nearest-line-color"
                    style="background-color:${line.color || "#666666"}"></span>
              <span class="nearest-primary-line-name">${escapeHtml(line.name)}</span>
              <span class="nearest-primary-line-count">${line.stationSize ? `${line.stationSize}駅` : ""}</span>
            </div>
          `).join("")}
        </div>

        <div class="nearest-primary-footer">
          <button
            type="button"
            class="nearest-primary-generate"
            disabled
            title="高次ボロノイ生成機能は未実装です"
          >
            高次ボロノイ生成
          </button>
        </div>

      </div>
    ` : "";


    // =========================
    // 2位以降の通常リスト
    // =========================
    const items = stations.slice(1).map((station, index) => `
    <div
      class="nearest-station"
      data-nearest-lat="${station.lat}"
      data-nearest-lng="${station.lng}"
      style="cursor:pointer;"
    >
      <div
        class="nearest-rank"
        style="
          ${station.rankColor ? `background-color: ${station.rankColor};` : ""}
          ${station.isAddedNearest ? "border: 2px solid #ff69b4; box-sizing: border-box;" : ""}
        "
      >${station.displayRank ?? index + 2}</div>

      <div class="nearest-info">

        <div class="nearest-top">
          <div class="nearest-name">
            ${escapeHtml(station.name)}
          </div>

          <div class="nearest-distance-attr">
            <span class="nearest-distance">
              ${station.distance >= 1000
        ? (station.distance / 1000).toFixed(2) + " km"
        : Math.round(station.distance) + " m"
      }
            </span>

            <span class="nearest-attr attr-${escapeHtml(station.attr || "unknown")}">
              ${escapeHtml(station.attr || "unknown")}
            </span>
          </div>
        </div>

        <div class="nearest-bottom">
          <div class="nearest-line">
            <span
              class="nearest-line-color"
              style="background-color:${station.lineColor || "#666666"}"
            ></span>

            <span>${escapeHtml(station.lineName || "路線不明")}</span>
          </div>

          <span class="nearest-coordinate">
            ${station.lat.toFixed(5)}, ${station.lng.toFixed(5)}
          </span>
        </div>

      </div>
    </div>
  `).join("");


    const methodDescription =
      mode === 'flat'
        ? '緯度・経度の差による平面計算で順位付けしています。'
        : 'Turf.jsでWeb Mercator平面座標に変換し、直線距離で順位付けしています。';


    // =========================
    // HTML出力
    // =========================
    content.innerHTML = `
      <h2 class="section-heading">
        クリック地点から近い駅（上位 ${stations.length} 駅）
      </h2>

      <div class="click-coordinate">
        クリック座標:
        ${clickPoint.lat.toFixed(6)},
        ${clickPoint.lng.toFixed(6)}
      </div>

      <p class="nearest-note">
        ${methodDescription}
        表示距離はLeafletによる測地距離です。
      </p>

      <button
        type="button"
        id="add-nearest-station"
        class="add-nearest-button"
      >
        選択駅の座標から未発見の近傍駅を追加
      </button>

      ${primaryCard}

      <div class="nearest-list">${items}</div>
    `;

    // 最近傍駅カードの路線クリック
    content.querySelectorAll(".nearest-primary-line[data-line-code]").forEach(item => {
      const select = () => {
        const lineCode = item.dataset.lineCode;
        if (!lineCode) return;

        window.dispatchEvent(
          new CustomEvent("select-railway-line", {
            detail: { lineCode }
          })
        );
      };

      item.addEventListener("click", select);

      // キーボード操作にも対応
      item.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      });
    });

    // =========================
    // 2位以降のクリック処理
    // =========================
    content.querySelectorAll(
      ".nearest-station[data-nearest-lat]"
    ).forEach(item => {

      item.addEventListener("click", () => {
        const lat = Number(item.dataset.nearestLat);
        const lng = Number(item.dataset.nearestLng);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const latlng = L.latLng(lat, lng);

        AppMap.moveClickMarker(latlng);
        AppStations.showNearest(latlng);
      });

    });


    // =========================
    // 近傍駅追加ボタン
    // =========================
    content
      .querySelector("#add-nearest-station")
      .addEventListener("click", () => {
        window.dispatchEvent(
          new Event("add-nearest-from-closest")
        );
      });

  }

  // ポリラインの頂点間の長さを合計（メートル）
  function calculatePolylineLength(coordinates) {
    let total = 0;

    for (let i = 1; i < coordinates.length; i++) {
      const from = L.latLng(coordinates[i - 1]);
      const to = L.latLng(coordinates[i]);

      total += from.distanceTo(to);
    }

    return total;
  }

  // 長さを見やすい単位で表示
  function formatPolylineLength(meters) {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }

    return `${Math.round(meters)} m`;
  }

  // スマホなどでタップ選択されている駅
  let selectedThroughItem = null;

  // 集計結果を詳細パネルに表示する
  function showThroughResult(result, sectionNumber) {
    const container = content.querySelector(
      `[data-through-results="${sectionNumber}"]`
    );

    if (!container) return;

    // 駅一覧を既存の近傍駅表示と同じ構造で作成
    function renderStationList(title, stations, groupName) {
      const items = stations.map((station, index) => {
        const point = station.sourcePoint;

        const rank = groupName === "nearest"
          ? 1
          : station.rank;

        const rankColor = groupName === "nearest"
          ? null
          : station.rankColor;

        const isStationCoordinateResult =
          station.sourceType === "nearest-station";

        const distance = Number.isFinite(station.distance)
          ? station.distance >= 1000
            ? (station.distance / 1000).toFixed(2) + " km"
            : Math.round(station.distance) + " m"
          : "";

        return `
    <div
      class="nearest-station through-station"
      data-through-group="${groupName}"
      data-through-index="${index}"
      data-through-lat="${point.lat}"
      data-through-lng="${point.lng}"
      title="計算座標: ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}"
    >
      <div
        class="nearest-rank"
        style="
          ${rankColor ? `background-color: ${rankColor};` : ""}
          ${isStationCoordinateResult
            ? "border: 2px solid #ff69b4; box-sizing: border-box;"
            : ""}
        "
      >${rank}</div>

      <div class="nearest-info">

        <!-- 上段：駅名・距離・属性 -->
        <div class="nearest-top">
          <div class="nearest-name">
            ${escapeHtml(station.name)}
          </div>

          <div class="nearest-distance-attr">
            ${distance
            ? `<span class="nearest-distance">${distance}</span>`
            : ""
          }

            <span class="nearest-attr attr-${escapeHtml(station.attr || "unknown")}">
              ${escapeHtml(station.attr || "unknown")}
            </span>
          </div>
        </div>

        <!-- 下段：路線・計算座標 -->
        <div class="nearest-bottom">
          <div class="nearest-line">
            <span
              class="nearest-line-color"
              style="background-color:${station.lineColor || "#666666"}"
            ></span>
            <span>${escapeHtml(station.lineName || "路線不明")}</span>
          </div>

          <span class="nearest-coordinate">
            ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}
          </span>
        </div>

      </div>
    </div>
  `;
      }).join("");

      return `
      <h3>${title}（${stations.length.toLocaleString()}駅）</h3>
      ${stations.length
          ? `<div class="nearest-list">${items}</div>`
          : '<p class="empty-message">該当する駅はありません。</p>'
        }
    `;
    }

    container.innerHTML = `
      <div class="through-summary">

        <div class="through-summary-header">
          <h3>集計結果</h3>
          <span class="through-status-badge">完了</span>
        </div>

        <div class="through-summary-main">
          <div class="through-result-card through-nearest-card">
            <div class="through-result-label">最近傍駅</div>
            <div class="through-result-value">
              ${result.nearestStations.length.toLocaleString()}
              <small>駅</small>
            </div>
          </div>

          <div class="through-result-card through-nearby-card">
            <div class="through-result-label">近傍駅</div>
            <div class="through-result-value">
              ${result.nearbyStations.length.toLocaleString()}
              <small>駅</small>
            </div>
          </div>
        </div>

        <div class="through-debug-info">
          <span>
            <b>サンプリング間隔</b>
            約 ${Number(result.sampleIntervalMeters).toLocaleString()} m
          </span>

          <span>
            <b>処理時間</b>
            ${result.elapsedMs < 1000
        ? `${result.elapsedMs.toFixed(1)} ms`
        : `${(result.elapsedMs / 1000).toFixed(2)} 秒`}
          </span>

          <span>
            <b>計算座標数</b>
            ${result.sampleCount.toLocaleString()} 点
          </span>
        </div>

      </div>

      ${renderStationList(
          "最近傍駅として出現した駅",
          result.nearestStations,
          "nearest"
        )}

      ${renderStationList(
          "近傍駅の集計結果",
          result.nearbyStations,
          "nearby"
        )}
    `;


    // 駅にマウスを乗せたら計算元の座標にピンと駅までの線を表示
    function showThroughStationLine(item, result) {
      const sourceLat = Number(item.dataset.throughLat);
      const sourceLng = Number(item.dataset.throughLng);
      const groupName = item.dataset.throughGroup;
      const index = Number(item.dataset.throughIndex);

      const stations =
        groupName === "nearest"
          ? result.nearestStations
          : result.nearbyStations;

      const station = stations[index];

      if (
        !station ||
        !Number.isFinite(sourceLat) ||
        !Number.isFinite(sourceLng) ||
        !Number.isFinite(Number(station.lat)) ||
        !Number.isFinite(Number(station.lng))
      ) {
        return;
      }

      const sourcePoint = L.latLng(sourceLat, sourceLng);
      const stationPoint = L.latLng(
        Number(station.lat),
        Number(station.lng)
      );

      clearThroughHover();

      // 計算座標のマーカー
      throughHoverMarker = L.marker(sourcePoint, {
        keyboard: false,
        interactive: false,
        zIndexOffset: 1000
      }).addTo(AppMap.map);

      // 計算座標から対象駅までのライン
      throughHoverLine = L.polyline(
        [sourcePoint, stationPoint],
        {
          color: "#e91e63",
          weight: 3,
          opacity: 0.95,
          interactive: false
        }
      ).addTo(AppMap.map);

      // 設定がONの場合だけ、ライン全体が見えるように調整
      if (typeof AppMap.fitThroughLine === "function") {
        AppMap.fitThroughLine(sourcePoint, stationPoint);
      }
    }

    function clearThroughSelection() {
      if (selectedThroughItem) {
        selectedThroughItem.classList.remove(
          "through-station-selected"
        );
        selectedThroughItem = null;
      }

      clearThroughHover();
    }

    function toggleThroughSelection(item, result) {
      // 選択中の駅を再タップしたら解除
      if (selectedThroughItem === item) {
        clearThroughSelection();
        return;
      }

      // 以前の選択を解除して、新しい駅を選択
      clearThroughSelection();

      selectedThroughItem = item;
      item.classList.add("through-station-selected");

      showThroughStationLine(item, result);
    }

    // showThroughResult() 内で、リストHTMLを設定した後に実行
    let lastPointerType = "mouse";

    container.querySelectorAll(".through-station").forEach(item => {
      item.addEventListener("pointerdown", event => {
        lastPointerType = event.pointerType || "mouse";
      });

      // PC：マウスが乗ったら表示
      item.addEventListener("pointerenter", event => {
        if (event.pointerType !== "mouse") return;

        // タップで固定選択されている場合はそちらを維持
        if (selectedThroughItem) return;

        showThroughStationLine(item, result);
      });

      // PC：マウスが離れたら消去
      item.addEventListener("pointerleave", event => {
        if (event.pointerType !== "mouse") return;

        // 固定選択中のラインは消さない
        if (selectedThroughItem) return;

        clearThroughHover();
      });

      // スマホ・タッチ端末：タップで選択／解除
      item.addEventListener("click", event => {
        // マウスクリックではホバー操作を優先する
        if (lastPointerType === "mouse") return;

        toggleThroughSelection(item, result);
      });
    });

  }

  function showRailway(line) {
    // 区間ごとのポリライン長を計算
    const sectionLengths = line.sections.map(section => ({
      section,
      length: calculatePolylineLength(section.coordinates)
    }));

    // 全区間の合計
    const totalLength = sectionLengths.reduce(
      (total, item) => total + item.length,
      0
    );

    // メイン情報
    const metaRows = [
      ["路線 ID", line.id],
      ["路線色", line.color],
      ["区間数", line.sections.length.toLocaleString()],
      ["座標数", line.pointCount.toLocaleString()],
      ["ポリライン総長", formatPolylineLength(totalLength)]
    ];

    // GPX・Aircraft・Overpass 共通のファイル情報
    if (line.isGpx || line.isAircraft || line.isOverpass) {
      metaRows.push(["ファイル", line.sourceFile || ""]);
    }

    // Aircraft 固有の情報
    if (line.isAircraft) {
      metaRows.push(
        ["便名", line.flightNumber],
        ["コールサイン", line.callsign],
        ["機種", line.model],
        ["機体登録番号", line.registration],
        ["出発空港", line.origin],
        ["到着空港", line.destination]
      );
    }

    const metaHtml = metaRows
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([label, value]) => `
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    `)
      .join("");

    // 近傍駅集計の除外設定
    const excludeSettings = window.AppThrough?.getExcludeSettings?.() || {};

    // 区間ごとの詳細
    const sectionHtml = line.sections.map(section => {
      const length = sectionLengths.find(
        item => item.section === section
      )?.length ?? 0;

      const propertiesHtml = line.isOverpass
        ? Object.entries(section.properties || {})
          .filter(([, value]) =>
            value !== null &&
            value !== undefined &&
            ["string", "number", "boolean"].includes(typeof value)
          )
          .map(([key, value]) => `
        <div class="coordinate-row">
          <span class="coordinate-label">${escapeHtml(key)}</span>
          <span class="coordinate-value">${escapeHtml(value)}</span>
        </div>
      `)
          .join("")
        : "";

      return `
      <article class="section-card">
        <h3>
          区間 ${section.number}
          （S${section.number} → E${section.number}）
        </h3>

        <div class="coordinate-row">
          <span class="coordinate-label">ポリライン長</span>
          <span class="coordinate-value">
            ${formatPolylineLength(length)}
          </span>
        </div>

        ${coordinateRows(
        "開始位置 S" + section.number,
        section.start
      )}

        ${coordinateRows(
        "終了位置 E" + section.number,
        section.end
      )}

        <div class="coordinate-row">
          <span class="coordinate-label">座標数</span>
          <span class="coordinate-value">
            ${section.coordinates.length.toLocaleString()} 点
          </span>
        </div>
        ${line.isOverpass ? `
          <h4>地図情報・属性</h4>
          ${propertiesHtml || '<p class="empty-message">属性がありません。</p>'}
        ` : ""}

        <button
          type="button"
          data-fit-section="${section.number}"
        >この区間に移動</button>
        <button
          type="button"
          data-analyze-through="${section.number}"
        >
          路線の近傍駅を表示
        </button>

        <div
          class="through-status"
          data-through-status="${section.number}"
        ></div>
        <div
          data-through-results="${section.number}"
        ></div>
      </article>
    `;
    }).join("");

    // 種類に応じた見出し
    const sectionHeading = line.isAircraft
      ? "軌跡の詳細"
      : line.isGpx
        ? "トラック区間の詳細"
        : "区間ごとの開始・終了位置";

    content.innerHTML = `
      <div class="detail-title-row">
        <span
          class="line-color-chip"
          style="background:${escapeHtml(line.color)}"
        ></span>
        <h2 class="detail-title">${escapeHtml(line.name)}</h2>
      </div>

      <dl class="detail-meta">
        ${metaHtml}
      </dl>

      ${line.isOverpass || line.isAircraft ? `
        <div class="through-exclude-settings">
          <div class="through-exclude-title">
            近傍駅集計の除外設定（一時設定）
          </div>

          ${line.isOverpass ? `
            <label>
              <input
                type="checkbox"
                id="exclude-tunnel-covered"
                ${excludeSettings.excludeTunnelCovered ? "checked" : ""}
              >
              トンネル・覆道は除外(データが存在する場合)
            </label>
          ` : ""}

          ${line.isAircraft ? `
            <label>
              <input
                type="checkbox"
                id="exclude-aircraft-overspeed"
                ${excludeSettings.excludeAircraftOverSpeed ? "checked" : ""}
              >
              900km/h以上は除外
            </label>
          ` : ""}
        </div>
      ` : ""}

      <!-- 復元した路線の直線表示 -->
      <div id="polyline-route-controls" class="polyline-route-controls">
        <div class="polyline-route-control-row">
          <button type="button" data-show-route="down">
            下りを表示
          </button>
          <button type="button" data-show-route-nearby="down">
            路線の近傍駅を表示
          </button>
          <div data-route-status="down" class="through-status"></div>
          <div data-through-results="down"></div>
        </div>

        <div class="polyline-route-control-row">
          <button type="button" data-show-route="up">
            上りを表示
          </button>
          <button type="button" data-show-route-nearby="up">
            路線の近傍駅を表示
          </button>
          <div data-route-status="up" class="through-status"></div>
          <div data-through-results="up"></div>
        </div>

        <div class="polyline-route-control-row">
          <button type="button" data-show-route="remaining">
            支線等を表示
          </button>
          <button type="button" data-show-route-nearby="remaining">
            路線の近傍駅を表示
          </button>
          <div data-route-status="remaining" class="through-status"></div>
          <div data-through-results="remaining"></div>
        </div>

        <div id="polyline-route-display"></div>
      </div>

      <h2 class="section-heading">${sectionHeading}</h2>


      ${sectionHtml || '<p class="empty-message">区間データがありません。</p>'}
    `;

    // トンネル・覆道の除外設定
    const excludeTunnelCheckbox = content.querySelector(
      "#exclude-tunnel-covered"
    );

    if (excludeTunnelCheckbox) {
      excludeTunnelCheckbox.addEventListener("change", event => {
        window.AppThrough.setExcludeTunnelCovered(event.target.checked);
      });
    }

    // Aircraftの速度除外設定
    const excludeAircraftCheckbox = content.querySelector(
      "#exclude-aircraft-overspeed"
    );

    if (excludeAircraftCheckbox) {
      excludeAircraftCheckbox.addEventListener("change", event => {
        window.AppThrough.setExcludeAircraftOverSpeed(event.target.checked);
      });
    }

    // ポリライン復元結果・駅データを必要に応じて取得
    let stationDataPromise = null;

    async function getRouteResult() {
      const routeResultPromise = AppRailway.getRouteResultPromise();

      if (!routeResultPromise) {
        throw new Error(
          "経路復元が完了していません。路線を選択し直してください。"
        );
      }

      return await routeResultPromise;
    }


    async function getStationData() {
      if (!stationDataPromise) {
        stationDataPromise = AppData.fetchJson(
          `./line/${encodeURIComponent(line.id)}.json`
        );
      }

      try {
        return await stationDataPromise;
      } catch (error) {
        stationDataPromise = null;
        throw error;
      }
    }



    // 経路復元結果を、表示・近傍駅計算用の座標列に変換
    function buildRouteEntries(result, selectedType) {

      const entries = [];

      // =========================
      // Overpass GeoJSON用
      // =========================
      if (line?.isOverpass) {

        if (!Array.isArray(result?.routes)) {
          console.error(
            "[Route] Overpass経路復元結果の形式が不正です",
            result
          );
          return entries;
        }

        result.routes.forEach((route, index) => {

          // Overpassの経路を既存ボタンに仮割り当て
          // 0番目 = 下り、1番目 = 上り、2番目以降 = その他
          const type = index === 0
            ? "down"
            : index === 1
              ? "up"
              : "remaining";

          const matches = selectedType === "remaining"
            ? type === "remaining"
            : type === selectedType;

          if (!matches) return;

          if (
            !Array.isArray(route.coordinates) ||
            route.coordinates.length < 2
          ) {
            console.warn(
              "[Route] Overpass経路の座標がありません",
              index,
              route
            );
            return;
          }

          // セクション情報を取得
          const sections = Array.isArray(route.sections)
            ? route.sections
            : Array.isArray(route.items)
              ? route.items
              : [];

          entries.push({
            type,
            coordinates: route.coordinates,
            sections,

            // トンネル・覆道情報を引き継ぐ
            segmentFlags: route.segmentFlags,

            routeIndex: index
          });
        });

        console.log("[Route] Overpass表示対象", {
          selectedType,
          routeCount: entries.length,
          sectionCount: entries.reduce(
            (sum, entry) =>
              sum + (
                entry.sections.length ||
                entry.coordinates.length
              ),
            0
          ),
          entries
        });

        return entries;
      }


      // =========================
      // 通常路線用（既存処理）
      // =========================
      if (
        !Array.isArray(result?.routes) ||
        !Array.isArray(result?.routeTypes)
      ) {
        console.error(
          "[Route] 経路復元結果の形式が不正です",
          result
        );
        return entries;
      }

      result.routes.forEach((route, index) => {

        const type = result.routeTypes[index];

        const matches = selectedType === "remaining"
          ? type !== "down" && type !== "up"
          : type === selectedType;

        if (!matches) return;

        const coordinates = [];

        for (const item of route) {

          const section = item.section ||
            line.sections.find(
              candidate =>
                String(candidate.number) ===
                String(item.sectionNumber)
            );

          if (!Array.isArray(section?.coordinates)) {
            console.warn(
              "[Route] セクションの座標がありません",
              item.sectionNumber
            );
            continue;
          }

          const points = item.reversed
            ? [...section.coordinates].reverse()
            : section.coordinates;

          for (const point of points) {

            const previous =
              coordinates[coordinates.length - 1];

            if (
              previous &&
              previous[0] === point[0] &&
              previous[1] === point[1]
            ) {
              continue;
            }

            coordinates.push(point);
          }
        }

        if (coordinates.length >= 2) {
          entries.push({
            type,
            coordinates,
            sections: route,
            routeIndex: index
          });
        }
      });

      console.log("[Route] 表示対象", {
        selectedType,
        routeCount: entries.length,
        sectionCount: entries.reduce(
          (sum, entry) =>
            sum + entry.sections.length,
          0
        ),
        entries
      });

      return entries;
    }



    // 近傍駅の集計結果を経路間で統合
    function mergeRouteResults(results) {
      const nearest = new Map();
      const nearby = new Map();
      const stationCoordinateResults = [];
      let sampleCount = 0;
      let elapsedMs = 0;
      const samples = [];

      const stationKey = station =>
        station.stationKey ??
        (station.id != null
          ? `id:${station.id}`
          : station.code != null
            ? `code:${station.code}`
            : `${station.name}|${station.lat}|${station.lng}`);

      for (const result of results) {
        sampleCount += result.sampleCount || 0;
        elapsedMs += result.elapsedMs || 0;
        samples.push(...(result.samples || []));

        for (const station of result.nearestStations || []) {
          const key = stationKey(station);
          if (!nearest.has(key)) nearest.set(key, station);
        }

        for (const station of result.nearbyStations || []) {
          const key = stationKey(station);
          const previous = nearby.get(key);

          if (!previous || station.rank < previous.rank) {
            nearby.set(key, station);
          }
        }

        stationCoordinateResults.push(
          ...(result.stationCoordinateResults || [])
        );
      }

      // 最近傍駅に登場した駅は近傍駅一覧から除外
      for (const key of nearest.keys()) {
        nearby.delete(key);
      }

      return {
        sectionNumber: "reconstructed",
        sampleIntervalMeters: 10,
        samples,
        nearestStations: [...nearest.values()],
        nearbyStations: [...nearby.values()],
        stationCoordinateResults,
        sampleCount,
        elapsedMs
      };
    }

    // 下り・上り・支線等の表示ボタン
    content.querySelectorAll("[data-show-route]").forEach(button => {
      button.addEventListener("click", async () => {
        const selectedType = button.dataset.showRoute;
        const output = content.querySelector("#polyline-route-display");

        content.querySelectorAll("[data-show-route]").forEach(item => {
          item.disabled = true;
        });

        if (output) output.textContent = "経路を復元しています...";

        try {
          const result = await getRouteResult();
          const entries = buildRouteEntries(result, selectedType);

          if (!entries.length) {
            AppMap.clearReconstructedRoute();
            if (output) output.textContent = "表示できる経路がありません。";
            return;
          }
          AppMap.clearReconstructedRoute();

          if (window.AppRailway?.showReconstructedRouteSections) {
            window.AppRailway.showReconstructedRouteSections(entries);
          }

          if (output) {
            const sectionCount = entries.reduce(
              (sum, entry) => sum + entry.sections.length,
              0
            );

            output.textContent =
              `表示経路: ${entries.length} 本 / ` +
              `使用区間: ${sectionCount} 区間`;
          }

        } catch (error) {
          console.error("経路表示エラー", error);
          if (output) output.textContent = `エラー: ${error.message}`;
        } finally {
          content.querySelectorAll("[data-show-route]").forEach(item => {
            item.disabled = false;
          });
        }
      });
    });


    // 統合ポリライン全体の近傍駅を集計・表示切替

    content.querySelectorAll("[data-show-route-nearby]").forEach(button => {
      button.addEventListener("click", async () => {
        const selectedType = button.dataset.showRouteNearby;
        const key = `route:${selectedType}`;

        const status = content.querySelector(
          `[data-route-status="${selectedType}"]`
        );

        const results = content.querySelector(
          `[data-through-results="${selectedType}"]`
        );

        // 集計済みなら表示・非表示だけを切り替える
        if (button.dataset.calculated === "true") {
          const isVisible = button.dataset.visible !== "false";
          const nextVisible = !isVisible;

          // ほかの集計結果を非表示にする
          AppMap.hideAllThroughResults(key);

          // 地図側の表示状態を変更
          AppMap.setThroughResultVisible(key, nextVisible);

          // 詳細パネル側も切り替える
          if (results) {
            results.style.display = nextVisible ? "" : "none";
          }

          button.dataset.visible = String(nextVisible);
          button.textContent = nextVisible
            ? "路線の近傍駅を隠す"
            : "路線の近傍駅を表示";

          return;
        }

        content.querySelectorAll("[data-show-route-nearby]").forEach(item => {
          item.disabled = true;
        });

        try {
          const result = await getRouteResult();
          const entries = buildRouteEntries(result, selectedType);

          if (!entries.length) {
            if (status) status.textContent = "集計対象の経路がありません。";
            return;
          }

          const allResults = [];

          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];

            allResults.push(
              await AppThrough.analyzeSection({
                number: `reconstructed-${selectedType}-${i + 1}`,
                coordinates: entry.coordinates,
                segmentFlags: entry.segmentFlags,
                sections: entry.sections,
                sectionNumbers: entry.sectionNumbers
              })
            );
          }

          const merged = mergeRouteResults(allResults);

          // ほかの結果を非表示にして、この結果を登録
          AppMap.hideAllThroughResults(key);
          AppMap.setThroughResult(key, merged);

          showThroughResult(merged, selectedType);

          button.dataset.calculated = "true";
          button.dataset.visible = "true";
          button.textContent = "路線の近傍駅を隠す";

          console.log("復元ポリラインの近傍駅集計", merged);

        } catch (error) {
          console.error("近傍駅の集計エラー", error);
          if (status) status.textContent = `集計エラー: ${error.message}`;

        } finally {
          content.querySelectorAll("[data-show-route-nearby]").forEach(item => {
            item.disabled = false;
          });
        }
      });
    });




    // 区間へ移動するボタン
    content.querySelectorAll("[data-fit-section]").forEach(button => {
      button.addEventListener("click", () => {

        const section = line.sections.find(
          item => item.number === Number(button.dataset.fitSection)
        );

        if (section && window.AppRailway) {

          // 復元経路を消去
          AppMap.clearReconstructedRoute();

          // 元のセクション表示に戻す
          AppRailway.setReconstructedRouteMode(false);

          // 指定区間へ移動
          AppRailway.showSection(line.id, section.number);
        }
      });
    });

    // ポリライン上の近傍駅を集計するボタン
    content.querySelectorAll("[data-analyze-through]").forEach(button => {
      button.addEventListener("click", async () => {
        const sectionNumber = Number(
          button.dataset.analyzeThrough
        );

        const section = line.sections.find(
          item => item.number === sectionNumber
        );

        if (!section) {
          console.error(
            "集計対象の区間が見つかりません:",
            sectionNumber
          );
          alert("集計対象の区間が見つかりません。");
          return;
        }

        if (!window.AppThrough) {
          console.error("window.AppThrough が定義されていません。");
          alert("through.js が正常に初期化されていません。");
          return;
        }

        const status = content.querySelector(
          `[data-through-status="${sectionNumber}"]`
        );

        const key = `section:${sectionNumber}`;
        const results = content.querySelector(
          `[data-through-results="${sectionNumber}"]`
        );

        // 計算済みなら表示・非表示だけを切り替える
        if (button.dataset.calculated === "true") {
          const isVisible = button.dataset.visible !== "false";
          const nextVisible = !isVisible;

          AppMap.hideAllThroughResults(key);
          AppMap.setThroughResultVisible(key, nextVisible);

          if (results) {
            results.style.display = nextVisible ? "" : "none";
          }

          button.dataset.visible = String(nextVisible);
          button.textContent = nextVisible
            ? "路線の近傍駅を隠す"
            : "路線の近傍駅を表示";

          return;
        }

        button.disabled = true;

        try {
          const result = await AppThrough.analyzeSection(section);


          // 解析結果を地図に反映
          AppMap.hideAllThroughResults(`section:${sectionNumber}`);
          AppMap.setThroughResult(`section:${sectionNumber}`, result);

          showThroughResult(result, sectionNumber);

          button.dataset.calculated = "true";
          button.dataset.visible = "true";
          button.textContent = "路線の近傍駅を隠す";

          console.log("近傍駅集計結果", result);

        } catch (error) {
          console.error("近傍駅の集計に失敗しました", error);

          if (status) {
            status.textContent = `集計エラー：${error.message}`;
          }
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  // 表示リセット処理
  function clearSelection() {

    // 通過駅のボロノイ表示を解除
    AppMap.clearThroughResult();

    AppMap.clearReconstructedRoute();

    // 復元経路表示モードを解除
    if (window.AppRailway) {
      AppRailway.setReconstructedRouteMode(false);
      AppRailway.clearSelection();
    }

    // クリック位置マーカー近傍駅のレイヤを削除
    AppMap.clearNearestStations();
  }

  // 外部から呼び出せるように公開
  window.clearSelection = clearSelection;


  function showEmpty() {
    content.innerHTML = '<p class="empty-message">地図をクリックすると、クリック地点から近い駅を表示します。路線をクリックすると路線の詳細を表示します。</p>';
  }

  return {
    showNearest,
    showRailway,
    showEmpty
  };
})();

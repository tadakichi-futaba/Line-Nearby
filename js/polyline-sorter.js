
/*
* polyline-sorter.js
*
* 入力:
*   line.sections
*   stationData.station_list
*
* 出力:
*   chains       : 接続されたセクション列
*   branches     : 分岐候補
*   disconnected : 接続できていない端点
*   diagnostics  : 判定内容
*
* 元の line.sections / coordinates は変更しない。
*/
window.PolylineSorter = (() => {
  const DEFAULTS = {
    // 駅順推定に利用する駅と線路の最大距離
    stationMaxDistance: 1500,

    // 同じ地点名の端点間距離がこれを超えたら警告
    endpointWarningDistance: 30,

    // 地点名のない端点を座標で照合する際の丸め桁数
    coordinateDigits: 5
  };

  const rad = value => value * Math.PI / 180;

  function distanceMeters(a, b) {
    const lat1 = a[0];
    const lon1 = a[1];
    const lat2 = b[0];
    const lon2 = b[1];

    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const meanLat = rad((lat1 + lat2) / 2);

    const x = dLon * Math.cos(meanLat);
    const y = dLat;

    return 6371000 * Math.sqrt(x * x + y * y);
  }

  // 線分上への投影位置を求める。
  // 戻り値の t は 0～1、distance は投影点までの距離。
  function projectPoint(point, a, b) {
    const meanLat = rad((point[0] + a[0] + b[0]) / 3);
    const scaleX = 6371000 * Math.cos(meanLat) * Math.PI / 180;
    const scaleY = 6371000 * Math.PI / 180;

    const ax = a[1] * scaleX;
    const ay = a[0] * scaleY;
    const bx = b[1] * scaleX;
    const by = b[0] * scaleY;
    const px = point[1] * scaleX;
    const py = point[0] * scaleY;

    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy;

    const t = denom === 0
      ? 0
      : Math.max(0, Math.min(
        1,
        ((px - ax) * dx + (py - ay) * dy) / denom
      ));

    const x = ax + t * dx;
    const y = ay + t * dy;

    return {
      t,
      distance: Math.hypot(px - x, py - y)
    };
  }

  function stationPositions(section, stations, maxDistance) {
    const coords = section.coordinates;
    const cumulative = [0];

    for (let i = 1; i < coords.length; i++) {
      cumulative[i] =
        cumulative[i - 1] + distanceMeters(coords[i - 1], coords[i]);
    }

    const totalLength = cumulative[cumulative.length - 1];
    if (totalLength === 0) return [];

    const marks = [];

    stations.forEach((station, stationIndex) => {
      if (!Number.isFinite(station.lat) ||
        !Number.isFinite(station.lng)) {
        return;
      }

      const point = [station.lat, station.lng];
      let best = null;

      for (let i = 1; i < coords.length; i++) {
        const projected = projectPoint(
          point, coords[i - 1], coords[i]
        );

        if (!best || projected.distance < best.distance) {
          const segmentLength = cumulative[i] - cumulative[i - 1];

          best = {
            distance: projected.distance,
            along: cumulative[i - 1] +
              projected.t * segmentLength
          };
        }
      }

      if (best && best.distance <= maxDistance) {
        marks.push({
          stationIndex,
          along: best.along / totalLength,
          distance: best.distance
        });
      }
    });

    // 同じ駅が近くの線路に複数回投影された場合などを考慮し、
    // ここでは推定に利用できる情報をそのまま保持する。
    return marks;
  }

  function orientationScore(marks) {
    if (marks.length < 2) {
      return {
        direction: 0,
        confidence: 0,
        count: marks.length
      };
    }

    const sorted = [...marks].sort((a, b) => a.along - b.along);
    let forward = 0;
    let backward = 0;
    let comparable = 0;

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const delta = sorted[j].stationIndex - sorted[i].stationIndex;

        if (delta === 0) continue;

        comparable++;
        if (delta > 0) forward++;
        else backward++;
      }
    }

    if (comparable === 0) {
      return { direction: 0, confidence: 0, count: marks.length };
    }

    const difference = forward - backward;

    return {
      // +1: 線路の座標方向が駅順と一致
      // -1: 線路の座標方向が駅順と逆
      //  0: 判断材料が足りない、または拮抗
      direction: Math.abs(difference) < 1 ? 0 : Math.sign(difference),
      confidence: Math.abs(difference) / comparable,
      count: marks.length
    };
  }

  function endpointKey(name, coord, options) {
    if (typeof name === "string" && name.trim()) {
      return `name:${name.trim()}`;
    }

    const digits = options.coordinateDigits;
    return `coord:${coord[0].toFixed(digits)
      },${coord[1].toFixed(digits)
      }`;
  }

  function reverseCoordinates(coords) {
    return [...coords].reverse().map(coord => [...coord]);
  }

  function analyze(line, stationData, userOptions = {}) {
    const options = { ...DEFAULTS, ...userOptions };
    const sections = line.sections || [];
    const stations = stationData?.station_list || [];

    const diagnostics = [];
    const edges = [];
    const nodes = new Map();

    function getNode(key, coord, name) {
      if (!nodes.has(key)) {
        nodes.set(key, {
          key,
          name: name || null,
          coordinates: [],
          edges: []
        });
      }

      const node = nodes.get(key);
      node.coordinates.push(coord);
      return node;
    }

    sections.forEach((section, index) => {
      if (!Array.isArray(section.coordinates) ||
        section.coordinates.length < 2) {
        diagnostics.push({
          type: "invalid-section",
          sectionNumber: section.number
        });
        return;
      }

      const start = section.coordinates[0];
      const end = section.coordinates[section.coordinates.length - 1];

      const startKey = endpointKey(section.startName, start, options);
      const endKey = endpointKey(section.endName, end, options);

      const a = getNode(startKey, start, section.startName);
      const b = getNode(endKey, end, section.endName);

      const marks = stationPositions(
        section, stations, options.stationMaxDistance
      );

      const edge = {
        id: edges.length,
        originalIndex: index,
        section,
        a,
        b,
        marks,
        orientation: orientationScore(marks)
      };

      edges.push(edge);
      a.edges.push(edge);
      b.edges.push(edge);
    });

    // 同名端点の座標が離れている場合を検出。
    for (const node of nodes.values()) {
      if (!node.key.startsWith("name:") ||
        node.coordinates.length < 2) {
        continue;
      }

      let maxDistance = 0;

      for (let i = 0; i < node.coordinates.length; i++) {
        for (let j = i + 1; j < node.coordinates.length; j++) {
          maxDistance = Math.max(
            maxDistance,
            distanceMeters(node.coordinates[i], node.coordinates[j])
          );
        }
      }

      if (maxDistance > options.endpointWarningDistance) {
        diagnostics.push({
          type: "endpoint-coordinate-mismatch",
          name: node.name,
          endpointCount: node.coordinates.length,
          maxDistanceMeters: Math.round(maxDistance)
        });
      }
    }

    // 次の未使用エッジをたどり、分岐点で経路を分割する。
    const used = new Set();
    const chains = [];

    function otherNode(edge, node) {
      return edge.a === node ? edge.b : edge.a;
    }

    function walk(startNode, firstEdge) {
      const chainEdges = [];
      let node = startNode;
      let edge = firstEdge;

      while (edge && !used.has(edge.id)) {
        used.add(edge.id);

        const nextNode = otherNode(edge, node);
        chainEdges.push({
          edge,
          from: node,
          to: nextNode,
          reversed: edge.a !== node
        });

        node = nextNode;

        // 次のノードが分岐点または終端なら、ここで経路を切る。
        if (node.edges.length !== 2) break;

        edge = node.edges.find(candidate => !used.has(candidate.id));
        if (!edge) break;
      }

      return chainEdges;
    }

    // 分岐点・終端から優先して経路を抽出する。
    for (const node of nodes.values()) {
      if (node.edges.length === 2) continue;

      if (node.edges.length > 2) {
        diagnostics.push({
          type: "branch",
          name: node.name,
          endpoint: node.key,
          degree: node.edges.length,
          sectionNumbers: node.edges.map(e => e.section.number)
        });
      }

      for (const edge of node.edges) {
        if (!used.has(edge.id)) {
          const path = walk(node, edge);
          if (path.length) chains.push(path);
        }
      }
    }

    // 分岐点を持たない閉路や、独立した循環経路を処理する。
    for (const edge of edges) {
      if (!used.has(edge.id)) {
        const path = walk(edge.a, edge);
        if (path.length) chains.push(path);
      }
    }

    function chainDirectionScore(path) {
      const marks = [];

      path.forEach((item, position) => {
        item.edge.marks.forEach(mark => {
          marks.push({
            stationIndex: mark.stationIndex,
            pathPosition:
              position + (item.reversed ? 1 - mark.along : mark.along)
          });
        });
      });

      // 同じ駅が複数セクションから検出された場合は、
      // 駅ごとの平均的な経路位置で比較する。
      const byStation = new Map();

      marks.forEach(mark => {
        if (!byStation.has(mark.stationIndex)) {
          byStation.set(mark.stationIndex, []);
        }
        byStation.get(mark.stationIndex).push(mark.pathPosition);
      });

      const ordered = [...byStation.entries()]
        .map(([stationIndex, positions]) => ({
          stationIndex,
          pathPosition:
            positions.reduce((a, b) => a + b, 0) / positions.length
        }))
        .sort((a, b) => a.pathPosition - b.pathPosition);

      let forward = 0;
      let backward = 0;

      for (let i = 0; i < ordered.length; i++) {
        for (let j = i + 1; j < ordered.length; j++) {
          if (ordered[j].stationIndex > ordered[i].stationIndex) forward++;
          else if (ordered[j].stationIndex < ordered[i].stationIndex) backward++;
        }
      }

      return {
        direction: forward === backward
          ? 0
          : forward > backward ? 1 : -1,
        confidence: forward + backward === 0
          ? 0
          : Math.abs(forward - backward) / (forward + backward),
        stationCount: ordered.length
      };
    }

    const results = chains.map((path, chainIndex) => {
      const score = chainDirectionScore(path);
      const orientedPath = score.direction < 0
        ? [...path].reverse().map(item => ({
          ...item,
          reversed: !item.reversed
        }))
        : path;

      const orderedSections = orientedPath.map(item => {
        const section = item.edge.section;
        const coordinates = item.reversed
          ? reverseCoordinates(section.coordinates)
          : section.coordinates.map(coord => [...coord]);

        return {
          number: section.number,
          originalIndex: item.edge.originalIndex,
          startName: item.reversed
            ? section.endName : section.startName,
          endName: item.reversed
            ? section.startName : section.endName,
          coordinates,
          reversed: item.reversed,
          stationCount: item.edge.marks.length,
          orientation: item.edge.orientation
        };
      });

      return {
        chainIndex,
        sections: orderedSections,
        direction: score.direction,
        confidence: score.confidence,
        stationCount: score.stationCount,
        closed: path.length > 0 &&
          path[0].from === path[path.length - 1].to
      };
    });

    // 端点の次数が1であるものは、グラフ上の終端候補。
    const endpoints = [...nodes.values()]
      .filter(node => node.edges.length === 1)
      .map(node => ({
        name: node.name,
        endpoint: node.key,
        sectionNumber: node.edges[0].section.number
      }));

    return {
      lineId: line.id,
      lineName: line.name,
      inputSectionCount: sections.length,
      validSectionCount: edges.length,
      chains: results,
      branches: diagnostics.filter(d => d.type === "branch"),
      endpoints,
      diagnostics,
      options
    };
  }

  function leftOffsetMeters(incomingBearing, nodeCoord, candidatePoint) {
    if (
      !Number.isFinite(incomingBearing) ||
      !Array.isArray(nodeCoord) ||
      !Array.isArray(candidatePoint) ||
      !Number.isFinite(nodeCoord[0]) ||
      !Number.isFinite(nodeCoord[1]) ||
      !Number.isFinite(candidatePoint[0]) ||
      !Number.isFinite(candidatePoint[1])
    ) {
      return 0;
    }

    const latRad = nodeCoord[0] * Math.PI / 180;

    // 接続点から候補路線の内側へ向かう距離（東・北方向）
    const dx =
      (candidatePoint[1] - nodeCoord[1]) *
      111320 * Math.cos(latRad);

    const dy =
      (candidatePoint[0] - nodeCoord[0]) *
      111320;

    const bearingRad = incomingBearing * Math.PI / 180;

    // 進行方向に対する左側への距離
    return -Math.cos(bearingRad) * dx
      + Math.sin(bearingRad) * dy;
  }

  // 端点から線路内部へ向かう方位角を計算するための診断用関数
  function diagnosticDistanceMeters(a, b) {
    const R = 6371000;
    const rad = Math.PI / 180;

    const lat1 = a[0] * rad;
    const lat2 = b[0] * rad;
    const dLat = (b[0] - a[0]) * rad;
    const dLng = (b[1] - a[1]) * rad;

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
  }

  // from から to への方位角（北=0度、東=90度）
  function diagnosticBearing(from, to) {
    const rad = Math.PI / 180;
    const lat1 = from[0] * rad;
    const lat2 = to[0] * rad;
    const dLng = (to[1] - from[1]) * rad;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  // 端点から線路内部へ、指定距離だけ進んだ位置を取得する
  function diagnosticInnerPoint(coordinates, endpoint, sampleMeters = 30) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      return null;
    }

    const points = endpoint === "start"
      ? coordinates
      : [...coordinates].reverse();

    const origin = points[0];
    let accumulated = 0;

    for (let i = 1; i < points.length; i++) {
      accumulated += diagnosticDistanceMeters(
        points[i - 1],
        points[i]
      );

      if (accumulated >= sampleMeters) {
        return points[i];
      }
    }

    // 区間が短い場合は、最後の座標を使う
    return points[points.length - 1];
  }

  // 2つの方位角の差（0～180度）
  function diagnosticAngleDifference(a, b) {
    const difference = Math.abs(a - b) % 360;
    return Math.min(difference, 360 - difference);
  }

  /**
  * 分岐点の端点座標・方位角・区間同士の角度を診断する。
  *
  * @param {Object} line 既存の路線オブジェクト
  * @param {number[]} sectionNumbers 診断対象の区間番号。省略時は全区間
  */
  function diagnoseJunctions(line, sectionNumbers) {
    const filter = sectionNumbers
      ? new Set(sectionNumbers.map(Number))
      : null;

    const endpointsByName = new Map();
    const endpointRows = [];
    const endpointRecords = [];

    for (const section of line.sections || []) {
      const number = Number(section.number);

      if (filter && !filter.has(number)) continue;

      const coordinates = section.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        continue;
      }

      for (const side of ["start", "end"]) {
        const name = side === "start"
          ? section.startName
          : section.endName;

        if (!name) continue;

        const endpoint = side === "start"
          ? coordinates[0]
          : coordinates[coordinates.length - 1];

        const inner = diagnosticInnerPoint(
          coordinates,
          side,
          30
        );

        if (!inner) continue;

        const bearing = diagnosticBearing(endpoint, inner);

        const record = {
          name,
          sectionNumber: number,
          sectionLabel: `S${number}`,
          side,
          lat: endpoint[0],
          lng: endpoint[1],
          bearing: Number(bearing.toFixed(1)),
          coordinateCount: coordinates.length,
          sampleDistance: Number(
            diagnosticDistanceMeters(endpoint, inner).toFixed(1)
          )
        };

        endpointRecords.push(record);

        if (!endpointsByName.has(name)) {
          endpointsByName.set(name, []);
        }
        endpointsByName.get(name).push(record);
      }
    }

    const junctions = [];
    const pairRows = [];

    for (const [name, records] of endpointsByName) {
      // 同名端点が3つ以上集まる場所を分岐候補とする
      if (records.length < 3) continue;

      junctions.push({
        name,
        degree: records.length,
        sections: [...new Set(
          records.map(r => r.sectionNumber)
        )].sort((a, b) => a - b).join(", ")
      });

      for (let i = 0; i < records.length; i++) {
        for (let j = i + 1; j < records.length; j++) {
          const a = records[i];
          const b = records[j];

          // 角度180度に近いほど、直線的な接続候補
          const angle = diagnosticAngleDifference(
            a.bearing,
            b.bearing
          );

          pairRows.push({
            junction: name,
            sectionA: a.sectionLabel,
            sideA: a.side,
            bearingA: a.bearing,
            sectionB: b.sectionLabel,
            sideB: b.side,
            bearingB: b.bearing,
            angle: Number(angle.toFixed(1)),
            straightness: Number(
              (180 - angle).toFixed(1)
            )
          });
        }
      }
    }

    console.group(`[PolylineSorter] ${line.name || line.id || ""} 接続診断`);

    console.log("分岐点一覧");
    console.table(junctions);

    console.log("端点座標・方位角");
    console.table(
      endpointRecords.sort((a, b) =>
        a.name.localeCompare(b.name, "ja") ||
        a.sectionNumber - b.sectionNumber ||
        a.side.localeCompare(b.side)
      )
    );

    console.log("接続候補ペア（angle が180度に近いほど直線的）");
    console.table(
      pairRows.sort((a, b) =>
        a.junction.localeCompare(b.junction, "ja") ||
        b.angle - a.angle
      )
    );

    console.groupEnd();

    return {
      junctions,
      endpoints: endpointRecords,
      pairs: pairRows
    };
  }

  // 分岐点での接続候補を、駅順序と方向から採点する
  function scoreJunctionConnections(line, stationData) {
    const stations = Array.isArray(stationData)
      ? stationData
      : stationData?.station_list;

    if (!Array.isArray(stations) || stations.length === 0) {
      console.warn(
        "[PolylineSorter] station_list が取得できません",
        stationData
      );
      return [];
    }

    const sections = line.sections || [];
    const marksBySection = new Map();
    const endpointsByName = new Map();

    // 各区間に含まれる駅を、路線全体の駅順序と対応づける
    for (const section of sections) {
      const marks = stationPositions(section, stations, 1500)
        .slice()
        .sort((a, b) => a.along - b.along);

      marksBySection.set(Number(section.number), marks);

      for (const side of ["start", "end"]) {
        const name = side === "start"
          ? section.startName
          : section.endName;

        if (!name) continue;

        const coordinates = section.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2) {
          continue;
        }

        const endpoint = side === "start"
          ? coordinates[0]
          : coordinates[coordinates.length - 1];

        const inner = diagnosticInnerPoint(
          coordinates,
          side,
          30
        );

        if (!inner) continue;

        const bearing = diagnosticBearing(endpoint, inner);

        // start は区間内で最初の駅、end は最後の駅を採用
        const marks = marksBySection.get(Number(section.number));
        const endpointMark = marks.length
          ? (side === "start" ? marks[0] : marks[marks.length - 1])
          : null;

        const record = {
          name,
          sectionNumber: Number(section.number),
          side,
          bearing,
          stationIndex: endpointMark?.stationIndex ?? null,
          stationDistance: endpointMark?.distance ?? null
        };

        if (!endpointsByName.has(name)) {
          endpointsByName.set(name, []);
        }

        endpointsByName.get(name).push(record);
      }
    }

    const results = [];

    for (const [name, records] of endpointsByName) {
      if (records.length < 2) continue;

      for (let i = 0; i < records.length; i++) {
        for (let j = i + 1; j < records.length; j++) {
          const a = records[i];
          const b = records[j];

          // 同一区間の start/end をペア候補にしない
          if (a.sectionNumber === b.sectionNumber) continue;

          const angle = diagnosticAngleDifference(
            a.bearing,
            b.bearing
          );

          // 180度に近いほど、区間同士が自然につながる
          const angleScore = 1 - Math.abs(180 - angle) / 180;

          let stationGap = null;
          let stationScore = null;

          if (
            Number.isFinite(a.stationIndex) &&
            Number.isFinite(b.stationIndex)
          ) {
            stationGap = Math.abs(
              a.stationIndex - b.stationIndex
            );

            // 駅順序が近い候補を優先する
            stationScore = Math.max(
              0,
              1 - stationGap / 4
            );
          }

          // 駅順序が分かる場合は両方を使用する。
          // 分からない場合は角度だけで仮採点する。
          const score = stationScore === null
            ? angleScore
            : angleScore * 0.6 + stationScore * 0.4;

          results.push({
            junction: name,
            sectionA: `S${a.sectionNumber}`,
            sideA: a.side,
            stationA: a.stationIndex,
            sectionB: `S${b.sectionNumber}`,
            sideB: b.side,
            stationB: b.stationIndex,
            stationGap,
            angle: Number(angle.toFixed(1)),
            angleScore: Number(angleScore.toFixed(3)),
            stationScore: stationScore === null
              ? null
              : Number(stationScore.toFixed(3)),
            score: Number(score.toFixed(3)),
            basis: stationScore === null
              ? "方向のみ・仮評価"
              : "方向＋駅順序"
          });
        }
      }
    }

    results.sort((a, b) =>
      a.junction.localeCompare(b.junction, "ja") ||
      b.score - a.score
    );

    console.group(
      `[PolylineSorter] 接続候補スコア: ${line.name || line.id || ""}`
    );
    console.log(
      "スコアは候補の優先順位を示す暫定値です。自動接続は行いません。"
    );
    console.table(results);
    console.groupEnd();

    return results;
  }


  function reconstructRoutes(line, stationData) {
    const stations = Array.isArray(stationData)
      ? stationData
      : stationData?.station_list;

    if (!Array.isArray(stations) || stations.length === 0) {
      throw new Error("station_list がありません");
    }

    const sections = (line.sections || []).filter(
      s => Array.isArray(s.coordinates) && s.coordinates.length >= 2
    );

    const nodes = new Map();
    const edges = [];
    const MAX_STATES = 100000;

    function stationName(station) {
      return String(
        station?.name ??
        station?.station_name ??
        station?.stationName ??
        station?.original_name ??
        ""
      ).trim();
    }

    function nodeKey(name, coord) {
      if (name) return `name:${String(name).trim()}`;
      return `coord:${Number(coord[0]).toFixed(5)},${Number(coord[1]).toFixed(5)}`;
    }

    function getNode(key, name, coord) {
      if (!nodes.has(key)) {
        nodes.set(key, {
          key,
          name: name || key,
          coord,
          edges: []
        });
      }
      return nodes.get(key);
    }

    function localVector(from, to) {
      const lat = (from[0] + to[0]) / 2;
      const rad = Math.PI / 180;

      return {
        x: (to[1] - from[1]) * Math.cos(lat * rad),
        y: to[0] - from[0]
      };
    }

    function bearing(from, to) {
      const v = localVector(from, to);
      return (Math.atan2(v.x, v.y) * 180 / Math.PI + 360) % 360;
    }

    function signedTurn(incoming, outgoing) {
      let d = incoming - outgoing;

      while (d > 180) d -= 360;
      while (d < -180) d += 360;

      // 正：左折、負：右折
      // bearing() は北=0度、東=90度なので符号を反転する
      return d;
    }


    function innerPoint(edge, fromNodeKey, distance = 30) {
      const points = edge.a.key === fromNodeKey
        ? edge.section.coordinates
        : [...edge.section.coordinates].reverse();

      let length = 0;

      for (let i = 1; i < points.length; i++) {
        length += diagnosticDistanceMeters(
          points[i - 1],
          points[i]
        );

        if (length >= distance) return points[i];
      }

      return points[points.length - 1];
    }

    // 区間の端点と駅順序情報を作る
    for (const section of sections) {
      const marks = stationPositions(section, stations, 1500)
        .slice()
        .sort((a, b) => a.along - b.along);

      const coordinates = section.coordinates;
      const startName = section.startName;
      const endName = section.endName;

      const a = getNode(
        nodeKey(startName, coordinates[0]),
        startName,
        coordinates[0]
      );

      const b = getNode(
        nodeKey(endName, coordinates[coordinates.length - 1]),
        endName,
        coordinates[coordinates.length - 1]
      );

      const edge = {
        id: edges.length,
        section,
        a,
        b,
        marks
      };

      edges.push(edge);
      a.edges.push(edge);
      b.edges.push(edge);
    }

    const maxStationIndex = stations.length - 1;

    function findStationNode(index) {
      const name = stationName(stations[index]);

      if (name) {
        const exact = nodes.get(`name:${name}`);
        if (exact) return exact;
      }

      // 端点名と駅名が一致しない場合は、
      // 駅インデックスを持つ区間の端点から推定する
      for (const edge of edges) {
        const indices = edge.marks
          .map(mark => mark.stationIndex)
          .filter(Number.isFinite);

        if (!indices.includes(index)) continue;

        const first = indices[0];
        const last = indices[indices.length - 1];

        if (first === index && last !== index) return edge.a;
        if (last === index && first !== index) return edge.b;
      }

      return null;
    }

    function orientedData(edge, currentNode) {
      const reversed = edge.a.key !== currentNode.key;

      const marks = reversed
        ? [...edge.marks].reverse()
        : edge.marks;

      const points = reversed
        ? [...edge.section.coordinates].reverse()
        : edge.section.coordinates;

      const indices = marks
        .map(mark => mark.stationIndex)
        .filter(Number.isFinite);

      return {
        reversed,
        marks,
        points,
        firstIndex: indices.length ? indices[0] : null,
        lastIndex: indices.length ? indices[indices.length - 1] : null
      };
    }

    function makeItem(edge, currentNode, nextNode, data) {
      return {
        sectionNumber: edge.section.number,
        section: edge.section,
        reversed: data.reversed,
        from: currentNode.name,
        to: nextNode.name,
        firstStationIndex: data.firstIndex,
        lastStationIndex: data.lastIndex
      };
    }

    function findDirectionalRoute(startNode, targetNode, direction) {
      let bestPath = [];
      let bestScore = -Infinity;
      let bestComplete = false;
      let bestProgress = direction === "down" ? -Infinity : Infinity;
      let visitedStates = 0;

      function isBetter(complete, progress, path, score) {
        if (complete !== bestComplete) return complete;

        if (progress !== bestProgress) {
          return direction === "down"
            ? progress > bestProgress
            : progress < bestProgress;
        }

        if (path.length !== bestPath.length) {
          return path.length > bestPath.length;
        }

        return score > bestScore;
      }

      function search(
        currentNode,
        incomingBearing,
        previousIndex,
        path,
        pathEdges,
        totalScore
      ) {
        if (++visitedStates > MAX_STATES) return;

        const complete = targetNode
          ? currentNode.key === targetNode.key
          : false;

        const progress = Number.isFinite(previousIndex)
          ? previousIndex
          : direction === "down" ? -Infinity : Infinity;

        if (isBetter(complete, progress, path, totalScore)) {
          bestPath = path.slice();
          bestScore = totalScore;
          bestComplete = complete;
          bestProgress = progress;
        }

        // 目的駅に到着したら、その経路を確定候補にする
        if (complete) return;


        const candidates = currentNode.edges
          .filter(edge => !pathEdges.has(edge))
          .map(edge => {
            const data = orientedData(edge, currentNode);
            const target = edge.a.key === currentNode.key
              ? edge.b
              : edge.a;

            const inside = innerPoint(edge, currentNode.key);

            const leftOffset = incomingBearing === null
              ? 0
              : leftOffsetMeters(
                incomingBearing,
                currentNode.coord,
                inside
              );

            /*
            console.log({
              section: edge.section?.number,
              current: currentNode.coord,
              inside,
              target: target.key
            });
            */

            const outgoingBearing = bearing(
              currentNode.coord,
              inside
            );

            const turn = incomingBearing === null
              ? 0
              : signedTurn(incomingBearing, outgoingBearing);


            // 駅順序は、逆方向への移動や支線への誤進入を
            // 判定するための補助スコアとして利用する。
            let orderScore = 0;

            if (
              Number.isFinite(data.firstIndex) &&
              Number.isFinite(data.lastIndex)
            ) {
              const sectionDelta =
                data.lastIndex - data.firstIndex;

              const directedDelta = direction === "down"
                ? sectionDelta
                : -sectionDelta;

              // 区間自体が駅順序と逆なら減点
              orderScore += directedDelta >= 0 ? 3 : -6;

              if (Number.isFinite(previousIndex)) {
                const delta = data.firstIndex - previousIndex;

                const directedGap = direction === "down"
                  ? delta
                  : -delta;

                if (directedGap >= -1) {
                  orderScore += 2;
                } else {
                  orderScore -= Math.min(
                    8,
                    Math.abs(directedGap)
                  );
                }
              }
            }

            // 通常の分岐では、直進性よりも左側を優先する。
            // signedTurn() では左側が正、右側が負。
            const isBranch = currentNode.edges.length >= 3;

            // ほぼ真後ろに戻る候補は通常は不適切。
            // ただし、ほかに候補がない場合は後段で再検討する。
            const angle = Math.abs(turn);
            const backwardPenalty = angle >= 135 ? -12 : 0;

            return {
              edge,
              target,
              data,
              turn,
              outgoingBearing,
              leftOffset,
              orderScore,
              backwardPenalty,
              score: 0
            };
          })
          .filter(Boolean)
        const isBranch = currentNode.edges.length >= 3;

        if (isBranch && incomingBearing !== null && candidates.length > 1) {
          const offsets = candidates.map(c => c.leftOffset);
          const maxLeft = Math.max(...offsets);
          const minLeft = Math.min(...offsets);
          const range = maxLeft - minLeft;

          for (const candidate of candidates) {
            // 位置の差が小さすぎる場合は、位置による採点をしない
            const leftScore = range > 0.5
              ? 10 * (candidate.leftOffset - minLeft) / range
              : 0;

            candidate.score =
              leftScore +
              candidate.orderScore +
              candidate.backwardPenalty;
          }
        } else {
          for (const candidate of candidates) {
            candidate.score =
              candidate.orderScore +
              candidate.backwardPenalty;
          }
        }

        candidates.sort((a, b) => b.score - a.score);
        /*
        console.table(candidates.map(candidate => ({
          section: candidate.edge.section?.number,
          target: candidate.target.key,
          turn: candidate.turn,
          bearing: candidate.outgoingBearing,
          firstIndex: candidate.data.firstIndex,
          lastIndex: candidate.data.lastIndex,
          score: candidate.score
        })));
        */


        // ほぼ180度戻る候補を避ける。
        // スイッチバックなどでほかに候補がない場合は許容する。
        const normalCandidates = candidates.filter(
          candidate => Math.abs(candidate.turn) < 135
        );

        const usableCandidates = normalCandidates.length
          ? normalCandidates
          : candidates;

        for (const candidate of usableCandidates) {
          if (visitedStates >= MAX_STATES) break;

          const { edge, target, data } = candidate;

          const points = data.points;
          const nextBearing = points.length >= 2
            ? bearing(
              points[points.length - 2],
              points[points.length - 1]
            )
            : candidate.outgoingBearing;

          const nextIndex = Number.isFinite(data.lastIndex)
            ? data.lastIndex
            : previousIndex;

          pathEdges.add(edge);
          path.push(
            makeItem(edge, currentNode, target, data)
          );

          search(
            target,
            nextBearing,
            nextIndex,
            path,
            pathEdges,
            totalScore + candidate.score
          );

          path.pop();
          pathEdges.delete(edge);
        }
      }

      if (!startNode) {
        return {
          path: [],
          visitedStates: 0,
          searchLimitReached: false,
          reachedTarget: false
        };
      }

      const initialIndex = direction === "down" ? 0 : maxStationIndex;

      search(
        startNode,
        null,
        initialIndex,
        [],
        new Set(),
        0
      );

      return {
        path: bestPath,
        visitedStates,
        searchLimitReached: visitedStates >= MAX_STATES,
        reachedTarget: bestComplete
      };
    }

    // 下り：station_list の先頭から末尾へ
    const downStart = findStationNode(0);
    const downEnd = findStationNode(maxStationIndex);

    const downResult = findDirectionalRoute(
      downStart,
      downEnd,
      "down"
    );

    // 上り：末尾から先頭へ。
    // 下りで使った区間も再利用できる
    const upResult = findDirectionalRoute(
      downEnd,
      downStart,
      "up"
    );

    const routes = [downResult.path, upResult.path];
    const routeTypes = ["down", "up"];

    // 下り・上りのどちらにも含まれない区間を回収する
    const usedEdges = new Set();

    for (const route of routes) {
      for (const item of route) {
        const edge = edges.find(
          candidate => candidate.section === item.section
        );
        if (edge) usedEdges.add(edge);
      }
    }

    function recoverRemainingRoutes() {
      const remaining = new Set(
        edges.filter(edge => !usedEdges.has(edge))
      );

      while (remaining.size) {
        const firstEdge = remaining.values().next().value;

        // できるだけ端点から残区間をたどる
        const startNode = [firstEdge.a, firstEdge.b].find(
          node => node.edges.filter(edge => remaining.has(edge)).length === 1
        ) || firstEdge.a;

        const path = [];
        const pathEdges = new Set();
        let currentNode = startNode;
        let incomingBearing = null;

        while (true) {
          let candidates = currentNode.edges
            .filter(edge => remaining.has(edge) && !pathEdges.has(edge))
            .map(edge => {
              const data = orientedData(edge, currentNode);
              const target = edge.a.key === currentNode.key
                ? edge.b
                : edge.a;

              const inside = innerPoint(edge, currentNode.key);
              const outgoingBearing = bearing(
                currentNode.coord,
                inside
              );

              const turn = incomingBearing === null
                ? 0
                : signedTurn(incomingBearing, outgoingBearing);

              return {
                edge,
                data,
                target,
                turn,
                outgoingBearing,
                score:
                  -Math.abs(turn) * 0.04 +
                  (Math.abs(turn) <= 45 ? 1.5 : 0) +
                  (turn > 0 ? 1 : 0)
              };
            })
            .sort((a, b) => b.score - a.score);

          const normal = candidates.filter(
            candidate => Math.abs(candidate.turn) < 135
          );

          if (normal.length) candidates = normal;

          if (!candidates.length) break;

          const candidate = candidates[0];
          const { edge, data, target } = candidate;

          path.push(
            makeItem(edge, currentNode, target, data)
          );

          pathEdges.add(edge);
          remaining.delete(edge);
          usedEdges.add(edge);

          const points = data.points;
          incomingBearing = points.length >= 2
            ? bearing(
              points[points.length - 2],
              points[points.length - 1]
            )
            : candidate.outgoingBearing;

          currentNode = target;
        }

        if (path.length) {
          routes.push(path);
          routeTypes.push("remaining");
        } else {
          // 安全策：どんな区間も黙って捨てない
          remaining.delete(firstEdge);
          usedEdges.add(firstEdge);

          routes.push([makeItem(
            firstEdge,
            firstEdge.a,
            firstEdge.b,
            orientedData(firstEdge, firstEdge.a)
          )]);
          routeTypes.push("remaining");
        }
      }
    }

    recoverRemainingRoutes();

    const usedSectionIds = new Set(
      [...usedEdges].map(edge => edge.id)
    );

    const unusedSections = edges
      .filter(edge => !usedSectionIds.has(edge.id))
      .map(edge => edge.section.number);

    const result = {
      routes,
      routeTypes,
      downStart: downStart?.name ?? null,
      downEnd: downEnd?.name ?? null,
      upStart: downEnd?.name ?? null,
      upEnd: downStart?.name ?? null,
      downReachedTarget: downResult.reachedTarget,
      upReachedTarget: upResult.reachedTarget,
      inputSectionCount: sections.length,
      usedSectionCount: usedSectionIds.size,
      unusedSections,
      allSectionsUsed: unusedSections.length === 0,
      searchLimitReached:
        downResult.searchLimitReached ||
        upResult.searchLimitReached,
      totalSearchStates:
        downResult.visitedStates +
        upResult.visitedStates
    };

    console.group("[PolylineSorter] 下り・上り別の経路復元");
    console.log("下り起点:", result.downStart);
    console.log("下り終点:", result.downEnd);
    console.log("上り起点:", result.upStart);
    console.log("上り終点:", result.upEnd);
    console.log("下り目的駅到達:", result.downReachedTarget);
    console.log("上り目的駅到達:", result.upReachedTarget);
    console.log("入力区間数:", result.inputSectionCount);
    console.log("使用区間数（重複を除く）:", result.usedSectionCount);
    console.log("全区間を使用:", result.allSectionsUsed);
    console.log("未使用区間:", result.unusedSections);
    console.log("探索上限到達:", result.searchLimitReached);
    console.log("探索状態数:", result.totalSearchStates);

    console.table(routes.flatMap((route, index) =>
      route.map((item, order) => ({
        route: index + 1,
        direction: routeTypes[index],
        order: order + 1,
        section: `S${item.sectionNumber}`,
        reversed: item.reversed,
        from: item.from,
        to: item.to,
        firstStationIndex: item.firstStationIndex,
        lastStationIndex: item.lastStationIndex
      }))
    ));

    console.groupEnd();

    return result;
  }

  // ========================================
  // Overpass ポリライン接続関係の解析
  // ========================================
  function analyzeOverpassConnections(line) {

    const sections = line?.sections || [];

    // 座標をキーにする
    // Overpassの座標は既に [lat, lng] に変換済み
    function coordinateKey(coord) {
      if (!Array.isArray(coord) || coord.length < 2) {
        return null;
      }

      const lat = Number(coord[0]);
      const lng = Number(coord[1]);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      return `${lat},${lng}`;
    }

    // 端点ごとの接続情報
    const nodes = new Map();

    // セクションの端点を登録
    function registerEndpoint(section, side, coord) {

      const key = coordinateKey(coord);

      if (key === null) return;

      if (!nodes.has(key)) {
        nodes.set(key, {
          key,
          coordinate: coord,
          endpoints: [],
          degree: 0
        });
      }

      const node = nodes.get(key);

      node.endpoints.push({
        sectionNumber: section.number,
        section,
        side
      });

      node.degree = node.endpoints.length;
    }

    // 全セクションの端点を登録
    let validSectionCount = 0;

    for (const section of sections) {

      const coordinates = section.coordinates;

      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        continue;
      }

      const start = coordinates[0];
      const end = coordinates[coordinates.length - 1];

      registerEndpoint(section, "start", start);
      registerEndpoint(section, "end", end);

      validSectionCount++;
    }

    // 接続関係を抽出
    const connections = [];

    for (const node of nodes.values()) {

      // 同じ座標を持つ端点が2つ以上あれば接続
      if (node.degree < 2) continue;

      const endpoints = node.endpoints;

      // 同じセクションの始点・終点同士は除外
      for (let i = 0; i < endpoints.length; i++) {
        for (let j = i + 1; j < endpoints.length; j++) {

          const a = endpoints[i];
          const b = endpoints[j];

          if (a.sectionNumber === b.sectionNumber) {
            continue;
          }

          connections.push({
            coordinate: node.coordinate,
            key: node.key,

            sectionA: a.sectionNumber,
            sideA: a.side,

            sectionB: b.sectionNumber,
            sideB: b.side
          });
        }
      }
    }

    // 接続点の分類
    const nodesArray = [...nodes.values()];

    const terminalNodes = nodesArray.filter(
      node => node.degree === 1
    );

    const normalNodes = nodesArray.filter(
      node => node.degree === 2
    );

    const branchNodes = nodesArray.filter(
      node => node.degree >= 3
    );

    const result = {
      lineId: line.id,
      lineName: line.name,

      sectionCount: sections.length,
      validSectionCount,

      nodes: nodesArray,
      connections,

      terminalNodes,
      normalNodes,
      branchNodes,

      isolatedSectionCount: terminalNodes.length
    };

    console.log("[Overpass] 接続解析完了", {
      lineName: line.name,
      sectionCount: sections.length,
      validSectionCount,

      endpointCount: nodesArray.length,
      connectionCount: connections.length,

      terminalCount: terminalNodes.length,
      normalCount: normalNodes.length,
      branchCount: branchNodes.length
    });

    console.log("[Overpass] 接続点一覧", nodesArray);
    console.log("[Overpass] セクション接続一覧", connections);

    return result;
  }

  // ========================================
  // Overpass ポリライン経路復元
  // ========================================
  function reconstructOverpassRoutes(line) {

    const sections = (line?.sections || []).filter(
      section =>
        Array.isArray(section.coordinates) &&
        section.coordinates.length >= 2
    );

    // ------------------------------------
    // 座標キー
    // ------------------------------------
    function coordinateKey(coord) {
      return `${Number(coord[0])},${Number(coord[1])}`;
    }

    // ------------------------------------
    // 接続点の構築
    // ------------------------------------
    const nodes = new Map();
    const edges = [];

    function registerEndpoint(section, edgeId, side, coord) {
      const key = coordinateKey(coord);

      if (!nodes.has(key)) {
        nodes.set(key, {
          key,
          coordinate: coord,
          endpoints: []
        });
      }

      nodes.get(key).endpoints.push({
        edgeId,
        sectionNumber: section.number,
        side
      });
    }

    sections.forEach((section, index) => {

      const coordinates = section.coordinates;

      const edge = {
        id: index,
        section,
        sectionNumber: section.number
      };

      edges.push(edge);

      registerEndpoint(
        section,
        edge.id,
        "start",
        coordinates[0]
      );

      registerEndpoint(
        section,
        edge.id,
        "end",
        coordinates[coordinates.length - 1]
      );
    });

    // ------------------------------------
    // 接続点から見た方向ベクトル
    // ------------------------------------
    function getOutwardVector(endpoint) {

      const coordinates =
        edges[endpoint.edgeId].section.coordinates;

      const point = endpoint.side === "start"
        ? coordinates[0]
        : coordinates[coordinates.length - 1];

      const neighbor = endpoint.side === "start"
        ? coordinates[1]
        : coordinates[coordinates.length - 2];

      const lat = point[0] * Math.PI / 180;

      return {
        x: (neighbor[1] - point[1]) * Math.cos(lat),
        y: neighbor[0] - point[0]
      };
    }

    // ------------------------------------
    // 2方向間の角度
    // 180度に近いほど直線的
    // ------------------------------------
    function getConnectionAngle(a, b) {

      const va = getOutwardVector(a);
      const vb = getOutwardVector(b);

      const dot = va.x * vb.x + va.y * vb.y;

      const lenA = Math.hypot(va.x, va.y);
      const lenB = Math.hypot(vb.x, vb.y);

      if (lenA === 0 || lenB === 0) return 0;

      const cosine = Math.max(
        -1,
        Math.min(1, dot / (lenA * lenB))
      );

      return Math.acos(cosine) * 180 / Math.PI;
    }

    // ------------------------------------
    // 分岐点で接続ペアを決定
    // ------------------------------------
    const transitions = new Map();

    const branchDiagnostics = [];

    for (const node of nodes.values()) {

      const endpoints = node.endpoints;

      if (endpoints.length < 2) continue;

      const candidates = [];

      for (let i = 0; i < endpoints.length; i++) {
        for (let j = i + 1; j < endpoints.length; j++) {

          const a = endpoints[i];
          const b = endpoints[j];

          // 同一セクションの始点・終点は接続しない
          if (a.edgeId === b.edgeId) continue;

          const angle = getConnectionAngle(a, b);

          candidates.push({
            a,
            b,
            angle,
            deviation: Math.abs(180 - angle)
          });
        }
      }

      // 直線に近い候補から優先
      candidates.sort(
        (a, b) => a.deviation - b.deviation
      );

      const used = new Set();
      const adopted = [];

      for (const candidate of candidates) {

        const keyA =
          `${candidate.a.edgeId}:${candidate.a.side}`;

        const keyB =
          `${candidate.b.edgeId}:${candidate.b.side}`;

        if (used.has(keyA) || used.has(keyB)) {
          continue;
        }

        used.add(keyA);
        used.add(keyB);

        transitions.set(keyA, candidate.b);
        transitions.set(keyB, candidate.a);

        adopted.push({
          sectionA: candidate.a.sectionNumber,
          sideA: candidate.a.side,
          sectionB: candidate.b.sectionNumber,
          sideB: candidate.b.side,
          angle: Number(candidate.angle.toFixed(2))
        });
      }

      if (endpoints.length >= 3) {
        branchDiagnostics.push({
          coordinate: node.coordinate,
          degree: endpoints.length,
          adopted
        });
      }
    }

    // ------------------------------------
    // 経路の追跡
    // ------------------------------------
    const usedEdges = new Set();
    const routes = [];

    function traceRoute(startEndpoint) {

      const route = [];

      let current = startEndpoint;

      while (current) {

        const edge = edges[current.edgeId];

        if (!edge || usedEdges.has(edge.id)) {
          break;
        }

        usedEdges.add(edge.id);

        const reversed = current.side === "end";

        route.push({
          sectionNumber: edge.sectionNumber,
          section: edge.section,
          reversed
        });

        // 今のセクションを抜ける側
        const arrivalSide = reversed ? "start" : "end";

        const arrivalKey =
          `${edge.id}:${arrivalSide}`;

        // 次に接続するセクション
        const next = transitions.get(arrivalKey);

        if (!next || usedEdges.has(next.edgeId)) {
          break;
        }

        current = next;
      }

      if (route.length > 0) {
        routes.push(route);
      }
    }

    // ------------------------------------
    // 端点・分岐点から経路を開始
    // ------------------------------------
    for (const node of nodes.values()) {

      for (const endpoint of node.endpoints) {

        const key =
          `${endpoint.edgeId}:${endpoint.side}`;

        // 接続先がない端点から開始
        if (transitions.has(key)) continue;

        if (usedEdges.has(endpoint.edgeId)) continue;

        traceRoute(endpoint);
      }
    }

    // ------------------------------------
    // 閉じた経路など、残りを復元
    // ------------------------------------
    for (const edge of edges) {

      if (usedEdges.has(edge.id)) continue;

      traceRoute({
        edgeId: edge.id,
        side: "start"
      });
    }

    // ------------------------------------
    // 座標を連結
    // トンネル・覆道情報も区間単位で保持
    // ------------------------------------
    const results = routes.map((route, index) => {

      const coordinates = [];
      const coordinateFlags = [];

      for (const item of route) {

        const section = item.section;

        const points = item.reversed
          ? [...section.coordinates].reverse()
          : section.coordinates;

        const isTunnelOrCovered =
          section.isTunnelOrCovered === true;

        for (const point of points) {

          const previous =
            coordinates[coordinates.length - 1];

          // 接続点が重複する場合は座標を追加しない
          // ただし、既存の座標の属性は変更しない
          if (
            previous &&
            previous[0] === point[0] &&
            previous[1] === point[1]
          ) {
            continue;
          }

          coordinates.push(point);

          coordinateFlags.push({
            isTunnelOrCovered
          });
        }
      }

      // 隣接する座標間の区間属性
      const segmentFlags = [];

      for (let i = 1; i < coordinateFlags.length; i++) {
        segmentFlags.push({
          isTunnelOrCovered:
            coordinateFlags[i - 1].isTunnelOrCovered ||
            coordinateFlags[i].isTunnelOrCovered
        });
      }

      return {
        routeIndex: index,
        sections: route,
        sectionNumbers: route.map(
          item => item.sectionNumber
        ),
        coordinates,

        // 座標・線分ごとのトンネル情報
        coordinateFlags,
        segmentFlags
      };
    });

    // ------------------------------------
    // 使用状況の検証
    // ------------------------------------
    const unusedSections = edges
      .filter(edge => !usedEdges.has(edge.id))
      .map(edge => edge.sectionNumber);

    const sectionUsage = new Map();

    for (const route of results) {
      for (const item of route.sections) {
        sectionUsage.set(
          item.sectionNumber,
          (sectionUsage.get(item.sectionNumber) || 0) + 1
        );
      }
    }

    const duplicatedSections = [...sectionUsage.entries()]
      .filter(([, count]) => count > 1)
      .map(([number, count]) => ({
        sectionNumber: number,
        count
      }));

    const result = {
      lineId: line.id,
      lineName: line.name,

      inputSectionCount: sections.length,
      usedSectionCount: usedEdges.size,

      routeCount: results.length,
      routes: results,

      branchDiagnostics,

      unusedSections,
      duplicatedSections,

      allSectionsUsed:
        usedEdges.size === sections.length
    };

    console.log("[Overpass] 経路復元完了", {
      lineName: line.name,
      inputSectionCount: result.inputSectionCount,
      usedSectionCount: result.usedSectionCount,
      routeCount: result.routeCount,
      allSectionsUsed: result.allSectionsUsed,
      unusedSections,
      duplicatedSections,
      branchDiagnostics
    });

    console.log("[Overpass] 復元経路一覧", results);

    console.log("[Overpass 統合結果]", results.map(route => ({
      routeIndex: route.routeIndex,
      coordinateCount: route.coordinates.length,
      segmentFlagCount: route.segmentFlags?.length,
      tunnelSegmentCount: route.segmentFlags?.filter(
        flag => flag.isTunnelOrCovered
      ).length,
      normalSegmentCount: route.segmentFlags?.filter(
        flag => !flag.isTunnelOrCovered
      ).length,
      firstFlags: route.segmentFlags?.slice(0, 10)
    })));

    return result;
  }



  return {
    analyze,
    diagnoseJunctions,
    scoreJunctionConnections,
    reconstructRoutes,
    analyzeOverpassConnections,
    reconstructOverpassRoutes
  };
})();

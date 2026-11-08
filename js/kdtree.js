
"use strict";

window.AppKDTree = (() => {

  // 2次元KD-treeを構築する
  function create(items, getX, getY) {
    const points = [];

    items.forEach((item, index) => {
      const x = getX(item);
      const y = getY(item);

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return;
      }

      points.push({
        item,
        index,
        x,
        y
      });
    });

    function build(source, depth = 0) {
      if (source.length === 0) return null;

      const axis = depth % 2;
      const key = axis === 0 ? "x" : "y";

      source.sort((a, b) =>
        a[key] - b[key] || a.index - b.index
      );

      const middle = Math.floor(source.length / 2);

      return {
        point: source[middle],
        axis,
        left: build(source.slice(0, middle), depth + 1),
        right: build(source.slice(middle + 1), depth + 1)
      };
    }

    const root = build(points);

    // 指定座標から近い順にN件を取得する
    function nearest(x, y, count) {
      if (
        !root ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        count <= 0
      ) {
        return [];
      }

      const limit = Math.floor(count);
      const best = [];

      function insertCandidate(point, distanceSquared) {
        const candidate = {
          point,
          distanceSquared
        };

        let index = 0;

        while (index < best.length) {
          const current = best[index];

          if (
            distanceSquared < current.distanceSquared ||
            (
              distanceSquared === current.distanceSquared &&
              point.index < current.point.index
            )
          ) {
            break;
          }

          index++;
        }

        best.splice(index, 0, candidate);

        if (best.length > limit) {
          best.pop();
        }
      }

      function search(node) {
        if (!node) return;

        const point = node.point;
        const dx = x - point.x;
        const dy = y - point.y;

        insertCandidate(
          point,
          dx * dx + dy * dy
        );

        const delta =
          node.axis === 0 ? dx : dy;

        const near =
          delta < 0 ? node.left : node.right;

        const far =
          delta < 0 ? node.right : node.left;

        search(near);

        const worstDistanceSquared =
          best.length < limit
            ? Infinity
            : best[best.length - 1].distanceSquared;

        // 境界上の同距離候補も調べ、順位の取りこぼしを防ぐ
        if (delta * delta <= worstDistanceSquared) {
          search(far);
        }
      }

      search(root);

      return best.map(candidate => candidate.point.item);
    }

    return {
      nearest,
      get size() {
        return points.length;
      }
    };
  }

  return {
    create
  };

})();

window.AppData = (() => {

  // ===== データ読み込み元 =====
  const DATA_SOURCE = "GITHUB_MY";
  // "LOCAL"
  // "GITHUB_OFFICIAL"
  // "GITHUB_MY"

  // ボロノイデータが自作なのでとりあえずリポジトリのその時点のデータ

  // ===== GitHub Raw URL =====

  // 公式データ
  const OFFICIAL_RAW_BASE =
    "https://raw.githubusercontent.com/Seo-4d696b75/station_database/main/out/main/";

  // 自分のリポジトリ
  const MY_RAW_BASE =
    "https://raw.githubusercontent.com/tadakichi-futaba/Line-Nearby/main/";

  // ===== 実行環境 =====
  const isLocalhost =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  // ===== 読み込み先決定 =====
  function getBaseUrl() {

    if (DATA_SOURCE === "LOCAL" && isLocalhost) {
      return "";
    }

    if (DATA_SOURCE === "GITHUB_MY") {
      return MY_RAW_BASE;
    }

    return OFFICIAL_RAW_BASE;
  }

  async function fetchJson(url) {

    const baseUrl = getBaseUrl();

    const fetchUrl = baseUrl + url.replace(/^\.?\//, "");

    const response = await fetch(fetchUrl);

    if (!response.ok) {
      const error = new Error(
        `${fetchUrl}: HTTP ${response.status}`
      );
      error.status = response.status;
      throw error;
    }

    return await response.json();
  }

  return {
    fetchJson
  };

})();
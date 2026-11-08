
// =========================
// 共通設定管理
// =========================

window.AppSettings = (() => {

  const STORAGE_KEY = "stationMapSettings";

  // 設定をすべて読み込む
  function getAll() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch (error) {
      console.warn("[AppSettings] 設定の読み込みに失敗:", error);
      return {};
    }
  }

  // 指定した設定を取得
  function get(key, defaultValue = null) {
    const settings = getAll();

    return settings[key] !== undefined
      ? settings[key]
      : defaultValue;
  }

  // 指定した設定を保存
  function set(key, value) {
    const settings = getAll();

    settings[key] = value;

    saveAll(settings);
  }

  // 複数の設定をまとめて更新
  function update(values) {
    const settings = getAll();

    Object.assign(settings, values);

    saveAll(settings);
  }

  // 設定全体を保存
  function saveAll(settings) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(settings)
      );
    } catch (error) {
      console.warn("[AppSettings] 設定の保存に失敗:", error);
    }
  }

  // 設定を初期化
  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn("[AppSettings] 設定の初期化に失敗:", error);
    }
  }

  return {
    getAll,
    get,
    set,
    update,
    saveAll,
    clear
  };

})();

// アプリ初期化
"use strict";

async function initialize() {
  const tasks = [
    {
      name: "ボロノイ図",
      run: window.loadVoronoi
    },
    {
      name: "路線",
      run: window.AppRailway.load
    },
    {
      name: "駅座標",
      run: window.AppStations.load
    }
  ];

  const results = await Promise.allSettled(
    tasks.map(task => task.run())
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`${tasks[index].name} 読み込み失敗:`, result.reason);
      const id = `error-${index}`;
      const status = document.getElementById("status");
      const message = document.createElement("div");
      message.id = id;
      message.className = "status-error";
      message.textContent = `${tasks[index].name} エラー: ${result.reason.message}`;
      status.appendChild(message);
    }
  });

  // 近傍駅モード切替ボタンを初期化
  window.AppStations.initNearestModeToggle();

  function initGpxImport() {
    const button = document.getElementById("gpx-load-button");
    const input = document.getElementById("gpx-file-input");

    if (!button || !input) {
      console.warn("GPX 読み込み UI が見つかりません");
      return;
    }

    button.addEventListener("click", () => {
      input.click();
    });

    input.addEventListener("change", async () => {
      const file = input.files?.[0];

      if (!file) return;

      try {
        await AppRailway.addGpxFile(file);
      } catch (error) {
        console.error("GPX 読み込み失敗:", error);
        alert(`GPXファイルを読み込めませんでした。\n${error.message}`);
      } finally {
        // 同じファイルを再度選択できるようにする
        input.value = "";
      }
    });
  }

  function initAircraftImport() {
    const button = document.getElementById("aircraft-load-button");
    const input = document.getElementById("aircraft-file-input");
    const pasteButton = document.getElementById("aircraft-paste-button");

    if (!button || !input || !pasteButton) {
      console.warn("Aircraft 読み込み UI が見つかりません");
      return;
    }

    // JSONファイル読み込み（従来どおり）
    button.addEventListener("click", () => {
      input.click();
    });

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;

      try {
        await AppRailway.addAircraftFile(file);
      } catch (error) {
        console.error("Aircraft 読み込み失敗:", error);
        alert(`Aircraft ファイルを読み込めませんでした。\n${error.message}`);
      } finally {
        input.value = "";
      }
    });

    // 表形式貼付モーダル
    let modal = document.getElementById("aircraft-paste-modal");

    if (!modal) {
      modal = document.createElement("div");
      modal.id = "aircraft-paste-modal";
      modal.className = "aircraft-paste-modal";

      modal.innerHTML = `
      <div class="aircraft-paste-dialog">
        <div class="aircraft-paste-header">
          <strong>FlightAware TrackLogの表形式データ読み込み</strong>
          <button type="button" id="aircraft-paste-close"
            aria-label="閉じる">×</button>
        </div>

        <textarea id="aircraft-paste-text"
          placeholder="FlightAware TrackLogの表形式データをここに貼り付けてください。"
          spellcheck="false"></textarea>

        <div class="aircraft-paste-footer">
          <span id="aircraft-paste-status"></span>
          <button type="button" id="aircraft-paste-import">
            読み込む
          </button>
        </div>
      </div>
    `;

      document.body.appendChild(modal);
    }

    const textarea = modal.querySelector("#aircraft-paste-text");
    const closeButton = modal.querySelector("#aircraft-paste-close");
    const importButton = modal.querySelector("#aircraft-paste-import");
    const status = modal.querySelector("#aircraft-paste-status");

    const closeModal = () => {
      modal.classList.remove("show");
    };

    pasteButton.addEventListener("click", () => {
      modal.classList.add("show");
      textarea.focus();
    });

    closeButton.addEventListener("click", closeModal);

    modal.addEventListener("click", event => {
      if (event.target === modal) closeModal();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeModal();
    });

    importButton.addEventListener("click", async () => {
      const text = textarea.value.trim();

      if (!text) {
        status.textContent = "データを貼り付けてください";
        return;
      }

      importButton.disabled = true;
      status.textContent = "読み込み中...";

      try {
        await AppRailway.addAircraftText(text);

        status.textContent = "読み込み完了";
        textarea.value = "";

        setTimeout(closeModal, 500);

      } catch (error) {
        console.error("Aircraft 表形式読み込み失敗:", error);
        status.textContent = error.message;
      } finally {
        importButton.disabled = false;
      }
    });
  }

  function initOverpassImport() {
    const button = document.getElementById("overpass-load-button");
    const input = document.getElementById("overpass-file-input");

    if (!button || !input) {
      console.warn("Overpass 読み込み UI が見つかりません");
      return;
    }

    button.addEventListener("click", () => {
      input.click();
    });

    input.addEventListener("change", async () => {
      const files = Array.from(input.files || []);

      try {
        for (const file of files) {
          try {
            await AppRailway.addOverpassFile(file);
          } catch (error) {
            console.error(
              `Overpass GeoJSON 読み込み失敗: ${file.name}`,
              error
            );
            alert(`${file.name}\n${error.message}`);
          }
        }
      } finally {
        input.value = "";
      }
    });
  }

  initGpxImport();
  initAircraftImport();
  initOverpassImport();

  // =========================
  // GPX読み込みメニュー
  // =========================
  function initGpxImportMenu() {
    const toggle = document.getElementById("gpx-import-menu-toggle");
    const menu = document.getElementById("gpx-import-menu");
    const content = document.getElementById("details-content");

    if (!toggle || !menu || !content) return;

    toggle.addEventListener("click", () => {
      // 詳細パネルをメニューに置き換える
      content.innerHTML = "";
      content.appendChild(menu);
      menu.classList.add("menu-open");

      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", "読み込みメニューを表示中");
    });
  }

  initGpxImportMenu();

}

initialize();

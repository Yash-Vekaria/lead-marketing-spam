var background = (function () {
  let tmp = {};
  chrome.runtime.onMessage.addListener(function (request) {
    for (let id in tmp) {
      if (tmp[id] && (typeof tmp[id] === "function")) {
        if (request.path === "background-to-options") {
          if (request.method === id) {
            tmp[id](request.data);
          }
        }
      }
    }
  });
  /*  */
  return {
    "receive": function (id, callback) {
      tmp[id] = callback;
    },
    "send": function (id, data) {
      chrome.runtime.sendMessage({
        "method": id, 
        "data": data,
        "path": "options-to-background"
      }, function () {
        return chrome.runtime.lastError;
      });
    }
  }
})();

var config = {
  "elements": {},
  "permissions": {
    "origins": ["*://*/*"],
    "permissions": ["declarativeNetRequestWithHostAccess"]
  },
  "load": function () {
    config.elements.cors = document.getElementById("cors");
    config.elements.padding = document.getElementById("padding");
    config.elements.download = document.getElementById("download");
    config.elements.scale = document.getElementById("scale-factor");
    config.elements.color = document.getElementById("background-color");
    config.elements.transparent = document.getElementById("transparent-background");
    /*  */
    config.elements.cors.addEventListener("change", config.listener.cors);
    config.elements.scale.addEventListener("change", config.listener.scale);
    config.elements.color.addEventListener("change", config.listener.color);
    config.elements.padding.addEventListener("change", config.listener.padding);
    config.elements.download.addEventListener("change", config.listener.download);
    config.elements.transparent.addEventListener("change", config.listener.transparent);
    /*  */
    config.render();
    window.removeEventListener("load", config.load, false);
  },
  "listener": {
    "color": function (e) {
      chrome.storage.local.set({"color": e.target.value});
    },
    "download": function (e) {
      chrome.storage.local.set({"download": e.target.checked});
    },
    "transparent": function (e) {
      config.elements.color.disabled = e.target.checked;
      chrome.storage.local.set({"transparent": e.target.checked});
    },
    "scale": function (e) {
      let tmp = parseInt(e.target.value);
      tmp = tmp > 10 ? 10 : (tmp < 1 ? 1 : tmp);
      chrome.storage.local.set({"scale": tmp});
    },
    "padding": function (e) {
      let tmp = parseInt(e.target.value);
      tmp = tmp > 1000 ? 1000 : (tmp < 0 ? 0 : tmp);
      chrome.storage.local.set({"padding": tmp});
    },
    "cors": function (e) {
      if (e.target.checked) {
        chrome.permissions.request(config.permissions, config.render);
      } else {
        chrome.permissions.remove(config.permissions, config.render);
      }
    }
  },
  "render": function () {
    const error = chrome.runtime.lastError;
    if (error) {
      if (error.message) {
        window.alert("This option is NOT currently available in your browser.\nIt will be available in browser version 102+");
      }
    }
    /*  */
    chrome.storage.local.get({
      "scale": 2,
      "padding": 0,
      "download": false,
      "color": "#ffffff",
      "transparent": false
    }, function (e) {
      config.elements.scale.value = e.scale;
      config.elements.color.value = e.color;
      config.elements.padding.value = e.padding;
      config.elements.download.checked = e.download;
      config.elements.color.disabled = e.transparent;
      config.elements.transparent.checked = e.transparent;
    });
    /*  */
    chrome.permissions.contains(config.permissions, function (e) {
      window.setTimeout(function () {
        config.elements.cors.checked = e;
      }, 300);
    });
  }
};

window.addEventListener("load", config.load, false);

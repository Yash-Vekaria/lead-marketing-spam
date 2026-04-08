if (background === undefined) {
  var background = (function () {
    let tmp = {};
    /*  */
    chrome.runtime.onMessage.addListener(function (request) {
      for (let id in tmp) {
        if (tmp[id] && (typeof tmp[id] === "function")) {
          if (request.path === "background-to-page") {
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
          "path": "page-to-background"
        }, function () {
          return chrome.runtime.lastError;
        });
      }
    }
  })();
  
  var config = {
    "scale": 2,
    "padding": 0,
    "download": false,
    "color": "#ffffff",
    "transparent": false,
    "DOM": {
      "element": {
        "current": null, 
        "previous": null
      }
    },
    "lightbox": {
      "element": {},
      "remove": function () {
        if (config.lightbox.element.a) config.lightbox.element.a.remove();
        if (config.lightbox.element.img) config.lightbox.element.img.remove();
        if (config.lightbox.element.close) config.lightbox.element.close.remove();
        if (config.lightbox.element.download) config.lightbox.element.download.remove();
        if (config.lightbox.element.container) config.lightbox.element.container.remove();
        if (config.lightbox.element.a) window.URL.revokeObjectURL(config.lightbox.element.a.href);
        /*  */
        config.lightbox.element = {};
      }
    },
    "target": {
      "is": {
        'a': function (e) {
          return e && e.target && e.target === config.lightbox.element.a;
        },
        "current": function (e) {
          return e && e.target && e.target === config.DOM.element.current;
        },
        "img": function (e) {
          return e && e.target && e.target === config.lightbox.element.img;
        },
        "close": function (e) {
          return e && e.target && e.target === config.lightbox.element.close;
        },
        "download": function (e) {
          return e && e.target && e.target === config.lightbox.element.download;
        }
      }
    },
    "action": {
      "keydown": function (e) {
        if (e) {
          if (e.code === "Escape" || e.key === "Escape") {
            config.lightbox.remove();
            background.send("state", {"state": "OFF"});
          }
        }
      },
      "download": function () {
        config.lightbox.element.a = document.createElement('a');
        config.lightbox.element.a.setAttribute("title", "Save screenshot");
        config.lightbox.element.a.href = config.lightbox.element.img.src;
        config.lightbox.element.a.download = "screenshot.png";
        document.body.appendChild(config.lightbox.element.a);
        /*  */
        config.lightbox.element.a.click();
        /*  */
        if (config.download) {
          if (config.lightbox.element.container) {
            config.lightbox.element.container.remove();
          }
        }
      },
      "success": function (blob) {
        window.setTimeout(function () {
          if (config.lightbox.element.img) {
            const src = window.URL.createObjectURL(blob);
            config.lightbox.element.img.removeAttribute("class");
            config.lightbox.element.img.src = src;
            /*  */
            if (config.download) {
              config.action.download();
            }
          }
        }, 300);
      },
      "error": function (e) {
        window.setTimeout(function () {
          // console.error(e);
          if (config.lightbox.element.img) {
            const src = chrome.runtime.getURL("data/content_script/resources/error.png");
            config.lightbox.element.img.removeAttribute("class");
            config.lightbox.element.img.src = src;
          }
        }, 300);
      },
      "update": function () {
        config.lightbox.remove();
        chrome.storage.local.get({
          "scale": 2,
          "padding": 0,
          "state": "OFF", 
          "download": false,
          "color": "#ffffff",
          "transparent": false
        }, function (e) {
          config.scale = e.scale;
          config.color = e.color;
          config.padding = e.padding;
          config.download = e.download;
          config.transparent = e.transparent;
          /*  */
          config.link.removeAttribute("href");
          window.removeEventListener("click", config.action.click, true);
          document.removeEventListener("keydown", config.action.keydown, false);
          document.removeEventListener("mouseover", config.action.mouseover, false);
          /*  */
          if (config.DOM.element.previous) {
            config.DOM.element.previous.removeAttribute("html-elements-screenshot-mouseover-effect");
          }
          /*  */
          if (e.state === "ON") {
            window.addEventListener("click", config.action.click, true);
            document.addEventListener("keydown", config.action.keydown, false);
            document.addEventListener("mouseover", config.action.mouseover, false);
            config.link.setAttribute("href", chrome.runtime.getURL("data/content_script/inject.css"));
          }
        });
      },
      "mouseover": function (e) {
        if (e) {
          if (e.target) {
            if (e.target !== config.lightbox.element.img) {
              if (e.target !== config.lightbox.element.close) {
                if (e.target !== config.lightbox.element.download) {
                  if (e.target !== config.lightbox.element.container) {
                    if (e.target !== config.DOM.element.previous) {
                      if (config.DOM.element.previous) {
                        config.DOM.element.previous.removeAttribute("html-elements-screenshot-mouseover-effect");
                      }
                      /*  */
                      config.DOM.element.current = e.target;
                      config.DOM.element.current.setAttribute("html-elements-screenshot-mouseover-effect", '');
                      config.DOM.element.previous = config.DOM.element.current;
                    }
                  }
                }
              }
            }
          }
        }
      },
      "click": function (e) {
        if (e) {
          const a = config.target.is.a(e);
          const img = config.target.is.img(e);
          const close = config.target.is.close(e);
          const current = config.target.is.current(e);
          const download = config.target.is.download(e);
          const other = !a && !img && !close && !current && !download;
          /*  */
          if (other) {
            config.lightbox.remove();
          } else if (download) {
            config.action.download();
          } else if (close) {
            config.lightbox.remove();
            background.send("state", {"state": "OFF"});
          } else if (current) {
            e.preventDefault();
            e.stopPropagation();
            /*  */
            config.lightbox.element.img = document.createElement("img");
            config.lightbox.element.close = document.createElement("div");
            config.lightbox.element.download = document.createElement("div");
            config.lightbox.element.container = document.createElement("div");        
            /*  */
            config.lightbox.element.close.textContent = "⛌";
            config.lightbox.element.download.textContent = "⇩";
            config.lightbox.element.img.setAttribute("class", "lightbox-loader");
            config.lightbox.element.close.setAttribute("class", "lightbox-close");
            config.lightbox.element.download.setAttribute("class", "lightbox-download");
            config.lightbox.element.container.setAttribute("class", "lightbox-container");
            config.lightbox.element.close.setAttribute("render", config.download ? "false" : "true");
            config.lightbox.element.download.setAttribute("render", config.download ? "false" : "true");
            config.lightbox.element.img.src = chrome.runtime.getURL("data/content_script/resources/loader.svg");
            /*  */
            config.lightbox.element.container.appendChild(config.lightbox.element.img);
            config.lightbox.element.container.appendChild(config.lightbox.element.close);
            config.lightbox.element.container.appendChild(config.lightbox.element.download);
            document.body.appendChild(config.lightbox.element.container);
            /*  */
            try {
              const options = {
                "scrollX": 0,
                "useCORS": true,
                "logging": false,
                "scale": config.scale,
                "scrollY": -1 * window.scrollY,
                "backgroundColor": config.transparent ? null : config.color
              };
              /*  */
              config.DOM.element.current.removeAttribute("html-elements-screenshot-mouseover-effect");
              html2canvas(config.DOM.element.current, options).then(canvas => {
                if (canvas) {
                  if (config.padding) {
                    const padding = config.padding;
                    const originalWidth = canvas.width;
                    const originalHeight = canvas.height;
                    const paddedCanvas = document.createElement("canvas");
                    const ctx = paddedCanvas.getContext("2d");
                    /*  */
                    paddedCanvas.width = originalWidth + padding * 2;
                    paddedCanvas.height = originalHeight + padding * 2;
                    ctx.fillStyle = config.transparent ? "transparent" : config.color;
                    ctx.fillRect(0, 0, paddedCanvas.width, paddedCanvas.height);
                    ctx.drawImage(canvas, padding, padding);
                    /*  */
                    canvas.width = paddedCanvas.width;
                    canvas.height = paddedCanvas.height;
                    canvas.getContext("2d").drawImage(paddedCanvas, 0, 0);
                  }
                  /*  */
                  canvas.toBlob(function (blob) {
                    if (blob) {
                      config.action.success(blob);
                    } else {
                      config.action.error("no blob");
                    }
                  });
                } else {
                  config.action.error("no canvas");
                }
              }).catch(function (e) {
                config.action.error(e);
              });
            } catch (e) {
              config.action.error(e);
            }
            /*  */
            window.setTimeout(function () {
              config.lightbox.element.container.style.opacity = 1;
              config.lightbox.element.container.style.display = "flex";
            }, 100);        
          }
        }
      }
    }
  };
  /*  */
  config.link = document.createElement("link");
  config.link.setAttribute("type", "text/css");
  config.link.setAttribute("rel", "stylesheet");
  document.documentElement.appendChild(config.link);
  /*  */
  config.action.update();
  background.receive("update", config.action.update);
} else {
  config.action.update();
}

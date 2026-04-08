var core = {
  "start": function () {
    core.load();
  },
  "install": function () {
    core.load();
  },
  "load": function () {
    core.update.addon("OFF");
  },
  "action": {
    "page": {
      "state": function (e) {
        core.update.addon(e.state);
      }
    },
    "button": function () {
      const tmp = config.addon.state === "ON" ? "OFF" : "ON";
      core.update.addon(tmp);
    },
    "tab": {
      "updated": function (info, tab) {
        if (tab.active) {
          if (info.status === "loading") {
            core.update.addon("OFF");
          }
        }
      }
    },
    "storage": function (changes, namespace) {
      const keys = [
        "scale", 
        "color", 
        "padding", 
        "download", 
        "transparent"
      ];
      /*  */
      if (keys.some(e => e in changes)) {
        core.update.addon(null);
      }
    }
  },
  "register": {
    "netrequest": function () {
      app.permissions.contains({
        "permissions": ["declarativeNetRequestWithHostAccess"]
      }, async function (granted) {
        if (granted) {
          await app.netrequest.display.badge.text(false);
          await app.netrequest.rules.remove.by.action.type("modifyHeaders", "responseHeaders");
          /*  */
          if (config.addon.state === "ON") {
            app.netrequest.rules.push({
              "condition": {
                "urlFilter": "*"
              },
              "action": {
                "type": "modifyHeaders",
                "responseHeaders": [
                  {
                    "value": "*",
                    "operation": "set",
                    "header": "Access-Control-Allow-Origin"
                  }, 
                  {
                    "value": "*",
                    "operation": "set",
                    "header": "Access-Control-Allow-Methods"
                  }
                ]
              }
            });
          }
          /*  */
          await app.netrequest.rules.update();
        }
      });
    }
  },
  "update": {
    "addon": function (state) {
      if (state) {
        if (config.addon.state !== state) {
          config.addon.state = state;
        }
      }
      /*  */
      core.register.netrequest();
      app.button.icon(null, config.addon.state);
      app.button.title(null, "HTML Elements Screenshot :: " + config.addon.state);
      /*  */
      if (config.addon.state === "OFF") {
        app.page.send("update");
      } else {
        app.tab.query.active(function (tab) {
          if (tab) {
            if (tab.url) {
              app.tab.inject.js({
                "target": {"tabId": tab.id}, 
                "func": function () {
                  return typeof background;
                }
              }, function (e) {
                if (e && e.length) {
                  if (e[0].result !== "undefined") {
                    app.page.send("update", null, tab.id, null);
                  } else {
                    app.tab.inject.js({
                      "target": {"tabId": tab.id}, 
                      "files": ["data/content_script/vendor/html2canvas.js"]
                    }, function () {
                      app.tab.inject.js({
                        "target": {"tabId": tab.id}, 
                        "files": ["data/content_script/inject.js"]
                      }, function () {
                        /*  */
                      });   
                    });
                  }
                } else {
                  setTimeout(function () {
                    core.update.addon("OFF");
                  }, 300);
                }
              });
            } else {
              app.page.send("update");
            }
          }
        });
      }
    }
  }
};

app.permissions.on.added(function () {
  core.update.addon(null);
});

app.permissions.on.removed(function () {
  core.update.addon(null);
});

app.button.on.clicked(core.action.button);
app.tab.on.updated(core.action.tab.updated);
app.page.receive("state", core.action.page.state);

app.on.startup(core.start);
app.on.installed(core.install);
app.on.storage(core.action.storage);

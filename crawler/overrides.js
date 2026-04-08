async function overrideJSFunctionsAndProperties() {

  function sendMessageToRedis(message) {
    if (typeof window.sendToQueue === 'function') {
      window.sendToQueue(message);  
    }
  }

  function generateUUID() {
    return window.crypto.getRandomValues(new Uint32Array(4)).join('-');
  }

  function parseStackTrace(stack) {
    const lines = stack.split('\n').slice(1);
    let id = lines.length;

    function extractDetails(line) {
      const regex = /^(?:\s*at\s+)?(?:(.*?)\s+\()?(?:<anonymous>\s*:\d+:\d+|[^@]*@)?(.*?)(?::(\d+))?(?::(\d+))?\)?\s*$/;
      const match = line.trim().match(regex);

      return {
        id: id--,
        functionName: match && match[1] ? match[1].trim() : 'anonymous',
        scriptUrl: match && match[2] ? match[2] : 'unknown',
        line: match && match[3] ? parseInt(match[3], 10) : null,
        column: match && match[4] ? parseInt(match[4], 10) : null
      };
    }

    const details = lines.map(line => extractDetails(line));
    return JSON.stringify(details);
  }

  function getCurrentDateTime() {
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const milliseconds = date.getMilliseconds().toString().padStart(3, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
  }

  // override window.addEventListener
  window.originalAddEventListener = window.addEventListener;

  window.addEventListener = function (type, listener, options) {
    const listenerStr = listener.toString();
    const serializedListener = listenerStr.indexOf('[native code]') !== -1 ? 'Function [native code]' : listenerStr;

    // Capture the stack trace at the point of listener initialization
    const stack = new Error().stack;
    const eventDetails = {
      override_type: "AddEventListener",
      type: type,
      function: serializedListener,
      options: options || false,
      init_invoke: "init",
      event_id: generateUUID(),
      stack: stack,
      eventTime: getCurrentDateTime(),
      site_id: window.measurement_data[0],
      site_url: window.measurement_data[1]
    };

    sendMessageToRedis(JSON.stringify(eventDetails));

    // Wrap the original listener to monitor invocations
    const wrappedListener = function (...args) {
      const seenObjects = new WeakSet(); // To keep track of seen objects and avoid circular references

      const replacer = (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seenObjects.has(value)) {
            return '[Circular]'; // Indicate circular reference
          }
          seenObjects.add(value); // Mark this object as seen

          if (value instanceof Node) {
            // Provide detailed information for DOM Nodes
            return {
              type: `Node: ${value.nodeName}`,
              id: value.id,
              classes: value.className,
              innerHTML: value.innerHTML.slice(0, 100) // Limit innerHTML content to avoid verbosity
            };
          }
          if (value instanceof Window) {
            return 'Window object'; // Simplified representation for Window objects
          }
        } else if (typeof value === 'function') {
          return `Function: ${value.name || 'anonymous'}`; // Provide information for functions
        }
        return value; // Return the value unchanged for other cases
      };

      const argsStr = JSON.stringify(args, replacer);

      const invokeStack = new Error().stack;
      const invokeEventDetails = {
        override_type: "AddEventListener",
        type: type,
        function: serializedListener,
        options: options || false,
        init_invoke: "invoke",
        init_stack: argsStr,
        event_id: eventDetails.event_id,
        stack: stack,//invokeStack,
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };
      sendMessageToRedis(JSON.stringify(invokeEventDetails));

      listener.apply(this, args);
    };

    return window.originalAddEventListener.call(this, type, wrappedListener, options);
  };

  // override window.removeEventListener
  window.originalRemoveEventListener = window.removeEventListener;
  window.removeEventListener = function (type, listener, options) {
    const listenerStr = listener.toString();
    const serializedListener = listenerStr.indexOf('[native code]') !== -1 ? 'Function [native code]' : listenerStr;

    // Capture the stack trace at the point of listener initialization
    const stack = new Error().stack;
    const eventDetails = {
      override_type: "RemoveEventListener",
      type: type,
      function: serializedListener,
      options: options || false,
      init_invoke: "init",
      event_id: generateUUID(),
      stack: stack,
      eventTime: getCurrentDateTime(),
      site_id: window.measurement_data[0],
      site_url: window.measurement_data[1]
    };

    sendMessageToRedis(JSON.stringify(eventDetails));

    return window.originalRemoveEventListener.call(this, type, listener, options);
  };

  // override window.fetch
  window.originalFetch = window.fetch;
  window.fetch = function (resource, init) {
    const stack = new Error().stack;
    const eventDetails = {
      functionName: 'fetch',
      stack: stack,
      init_invoke: "invoke",
      event_id: generateUUID(),
      eventTime: getCurrentDateTime(),
      site_id: window.measurement_data[0],
      site_url: window.measurement_data[1]
    };

    sendMessageToRedis(JSON.stringify(eventDetails));
    return window.originalFetch.call(this, resource, init);
  };

  // override XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
    this.addEventListener('load', function () {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'XMLHttpRequest',
        method: method,
        url: url,
        stack: stack,
        init_invoke: "invoke",
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
    });

    return originalOpen.apply(this, arguments);
  };


  // override document.forms
  const originalForms = Object.getOwnPropertyDescriptor(Document.prototype, 'forms').get;
  Object.defineProperty(Document.prototype, 'forms', {
    get: function () {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'document.forms',
        stack: stack,
        init_invoke: "invoke",
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      return originalForms.call(this);
    },
    configurable: true
  });


  // override document.body
  const originalBodyGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'body').get;

  Object.defineProperty(Document.prototype, 'body', {
    get: function () {
      const stack = new Error().stack; // Capture the stack trace at the moment of access
      const eventDetails = {
        functionName: 'document.body',
        stack: stack,
        init_invoke: "invoke",
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      return originalBodyGetter.call(this); // Call the original getter to return the actual body element
    },
    configurable: true // Ensure the property definition can be changed in the future if needed
  });


  // override global event listeners

  const eventTypes = ['onkeyup', 'onkeypress', 'onkeydown'];

  eventTypes.forEach(eventType => {
    const originalSetter = Object.getOwnPropertyDescriptor(HTMLElement.prototype, eventType).set;

    Object.defineProperty(HTMLElement.prototype, eventType, {
      set: function (callback) {
        const stack = new Error().stack;
        const eventDetails = {
          functionName: eventType,
          callback: callback.toString(),
          stack: stack,
          init_invoke: "invoke",
          is_set: true,
          event_id: generateUUID(),
          eventTime: getCurrentDateTime(),
          site_id: window.measurement_data[0],
          site_url: window.measurement_data[1]
        };

        sendMessageToRedis(JSON.stringify(eventDetails));
        originalSetter.call(this, callback);
      },
      configurable: true
    });
  });


  // override Websocket
  const originalWebSocket = window.WebSocket;

  window.WebSocket = function (url, protocols) {
    const initStack = new Error().stack;
    const initEventDetails = {
      functionName: 'WebSocket',
      init_invoke: 'init',
      url: url,
      protocols: protocols,
      stack: initStack,
      event_id: generateUUID(),
      eventTime: getCurrentDateTime(),
      site_id: window.measurement_data[0],
      site_url: window.measurement_data[1]
    };
    sendMessageToRedis(JSON.stringify(initEventDetails));

    // Create a new WebSocket instance
    const wsInstance = new originalWebSocket(url, protocols);

    // Override the 'send' method to monitor invocation
    const originalSend = wsInstance.send;
    wsInstance.send = function (data) {
      const invokeStack = new Error().stack;
      const sendEventDetails = {
        functionName: 'WebSocket.send',
        init_invoke: 'invoke',
        data: data,
        stack: invokeStack,
        init_stack: initStack,
        event_id: initEventDetails.event_id,
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };
      sendMessageToRedis(JSON.stringify(sendEventDetails));

      // Call the original 'send' method
      originalSend.call(this, data);
    };

    // Override the 'onmessage' event to monitor incoming messages
    Object.defineProperty(wsInstance, 'onmessage', {
      set: function (handler) {
        const wrappedHandler = (event) => {
          const messageStack = new Error().stack;
          const messageEventDetails = {
            functionName: 'WebSocket.onmessage',
            init_invoke: 'invoke',
            data: event.data,
            stack: messageStack,
            init_stack: initStack,
            is_set: true,
            event_id: initEventDetails.event_id,
            eventTime: getCurrentDateTime(),
            site_id: window.measurement_data[0],
            site_url: window.measurement_data[1]
          };
          sendMessageToRedis(JSON.stringify(messageEventDetails));

          handler.call(this, event);
        };

        Reflect.defineProperty(this, '_onmessage', {
          value: wrappedHandler,
          enumerable: false,
          configurable: true,
          writable: true
        });
      },
      get: function () {
        return this._onmessage;
      },
      enumerable: true,
      configurable: true
    });

    return wsInstance;
  };

  for (let key in originalWebSocket) {
    if (originalWebSocket.hasOwnProperty(key)) {
      window.WebSocket[key] = originalWebSocket[key];
    }
  }


  // override MutationObserver

  const originalMutationObserver = window.MutationObserver;

  window.MutationObserver = function (callback) {
    // Capture the stack trace at the point of MutationObserver initialization
    const initStack = new Error().stack;
    const initEventDetails = {
      functionName: 'MutationObserver',
      callback: callback.toString(), // Truncated for brevity
      init_invoke: "init",
      stack: initStack,
      event_id: generateUUID(),
      eventTime: getCurrentDateTime(),
      site_id: window.measurement_data[0],
      site_url: window.measurement_data[1]
    };

    sendMessageToRedis(JSON.stringify(initEventDetails));

    // Wrap the original callback to monitor invocations
    const wrappedCallback = function (mutationsList, observer) {
      const invokeStack = new Error().stack;

      const invokeEventDetails = {
        functionName: 'MutationObserver',
        callback: callback.toString(),
        init_invoke: "invoke",
        stack: initStack,// invokeStack,
        init_stack: null, //initStack,
        event_id: initEventDetails.event_id,
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(invokeEventDetails));
      // Invoke the original callback with the correct context, mutationsList, and observer
      callback.call(this, mutationsList, observer);
    };

    return new originalMutationObserver(wrappedCallback);
  };


  // override originalGetElementById
  const originalGetElementById = document.getElementById;
  document.getElementById = function (id) {
    const element = originalGetElementById.call(document, id);
    if (element instanceof HTMLFormElement) {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'document.getElementById',
        id: id,
        stack: stack,
        init_invoke: "invoke",
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };
      sendMessageToRedis(JSON.stringify(eventDetails));
    }
    return element;
  };

  // Override getElementsByName
  const originalGetElementsByName = document.getElementsByName;
  document.getElementsByName = function (name) {
    const elements = originalGetElementsByName.call(document, name);
    Array.from(elements).forEach(element => {
      if (element instanceof HTMLFormElement) {
        const stack = new Error().stack;
        const eventDetails = {
          functionName: 'document.getElementsByName',
          name: name,
          stack: stack,
          init_invoke: "invoke",
          event_id: generateUUID(),
          eventTime: getCurrentDateTime(),
          site_id: window.measurement_data[0],
          site_url: window.measurement_data[1]
        };
        sendMessageToRedis(JSON.stringify(eventDetails));
      }
    });
    return elements;
  };

  // Override getElementsByClassName
  const originalGetElementsByClassName = document.getElementsByClassName;
  document.getElementsByClassName = function (className) {
    const elements = originalGetElementsByClassName.call(document, className);
    Array.from(elements).forEach(element => {
      if (element instanceof HTMLFormElement) {
        const stack = new Error().stack;
        const eventDetails = {
          functionName: 'document.getElementsByClassName',
          className: className,
          stack: stack,
          init_invoke: "invoke",
          event_id: generateUUID(),
          eventTime: getCurrentDateTime(),
          site_id: window.measurement_data[0],
          site_url: window.measurement_data[1]
        };
        sendMessageToRedis(JSON.stringify(eventDetails));
      }
    });
    return elements;
  };

  // Override getElementsByTagName
  const originalGetElementsByTagName = document.getElementsByTagName;
  document.getElementsByTagName = function (tagName) {
    const elements = originalGetElementsByTagName.call(document, tagName);
    Array.from(elements).forEach(element => {
      if (element instanceof HTMLFormElement) {
        const stack = new Error().stack;
        const eventDetails = {
          functionName: 'document.getElementsByTagName',
          tagName: tagName,
          stack: stack,
          init_invoke: "invoke",
          event_id: generateUUID(),
          eventTime: getCurrentDateTime(),
          site_id: window.measurement_data[0],
          site_url: window.measurement_data[1]
        };
        sendMessageToRedis(JSON.stringify(eventDetails));
      }
    });
    return elements;
  };

  // Override getElementsByTagNameNS
  const originalGetElementsByTagNameNS = document.getElementsByTagNameNS;
  document.getElementsByTagNameNS = function (namespaceURI, localName) {
    const elements = originalGetElementsByTagNameNS.call(document, namespaceURI, localName);
    Array.from(elements).forEach(element => {
      if (element instanceof HTMLFormElement) {
        const stack = new Error().stack;
        const eventDetails = {
          functionName: 'document.getElementsByTagNameNS',
          namespaceURI: namespaceURI,
          localName: localName,
          stack: stack,
          init_invoke: "invoke",
          event_id: generateUUID(),
          eventTime: getCurrentDateTime(),
          site_id: window.measurement_data[0],
          site_url: window.measurement_data[1]
        };
        sendMessageToRedis(JSON.stringify(eventDetails));
      }
    });
    return elements;
  };

  // Override querySelector
  const originalQuerySelector = document.querySelector;
  document.querySelector = function (selector) {
    const element = originalQuerySelector.call(document, selector);
    if (element instanceof HTMLFormElement) {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'document.querySelector',
        selector: selector,
        stack: stack,
        init_invoke: "invoke",
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };
      sendMessageToRedis(JSON.stringify(eventDetails));
    }
    return element;
  };

  // Override querySelectorAll
  const originalQuerySelectorAll = document.querySelectorAll;
  document.querySelectorAll = function (selector) {
    const elements = originalQuerySelectorAll.call(document, selector);
    Array.from(elements).forEach(element => {
      if (element instanceof HTMLFormElement) {
        const stack = new Error().stack;
        const eventDetails = {
          functionName: 'document.querySelectorAll',
          selector: selector,
          stack: stack,
          init_invoke: "invoke",
          event_id: generateUUID(),
          eventTime: getCurrentDateTime(),
          site_id: window.measurement_data[0],
          site_url: window.measurement_data[1]
        };
        sendMessageToRedis(JSON.stringify(eventDetails));
      }
    });
    return elements;
  };

  // override document.cookie
  const originalCookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  Object.defineProperty(Document.prototype, 'cookie', {
    get: function () {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'document.cookie',
        stack: stack,
        init_invoke: "invoke",
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      return originalCookieDescriptor.get.call(this);
    },
    set: function (value) {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'document.cookie',
        stack: stack,
        init_invoke: "invoke",
        is_set: true,
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        value: value,
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      return originalCookieDescriptor.set.call(this, value);
    },
    configurable: true
  });

  // override canvas API
  const originalCanvasToDataURL = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (contextType, contextAttributes) {
    const stack = new Error().stack;
    const eventDetails = {
      functionName: 'HTMLCanvasElement.getContext',
      contextType: contextType,
      contextAttributes: contextAttributes,
      stack: stack,
      init_invoke: "invoke",
      event_id: generateUUID(),
      eventTime: getCurrentDateTime(),
      site_id: window.measurement_data[0],
      site_url: window.measurement_data[1]
    };

    sendMessageToRedis(JSON.stringify(eventDetails));
    return originalCanvasToDataURL.call(this, contextType, contextAttributes);
  };

  // override localStorage
  const originalLocalStorage = window.localStorage;
  window.localStorage = new Proxy(originalLocalStorage, {
    get: function (target, property) {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'localStorage',
        property: property,
        stack: stack,
        init_invoke: "invoke",
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      return target[property];
    },
    set: function (target, property, value) {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'localStorage',
        property: property,
        value: value,
        stack: stack,
        init_invoke: "invoke",
        is_set: true,
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      target[property] = value;
    }
  });

  // override sessionStorage
  const originalSessionStorage = window.sessionStorage;
  window.sessionStorage = new Proxy(originalSessionStorage, {
    get: function (target, property) {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'sessionStorage',
        property: property,
        stack: stack,
        init_invoke: "invoke",
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      return target[property];
    },
    set: function (target, property, value) {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'sessionStorage',
        property: property,
        value: value,
        stack: stack,
        init_invoke: "invoke",
        is_set: true,
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      target[property] = value;
    }
  });

  // override navigator
  const originalNavigator = window.navigator;
  window.navigator = new Proxy(originalNavigator, {
    get: function (target, property) {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'navigator',
        property: property,
        stack: stack,
        init_invoke: "invoke",
        is_set: false,
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      return target[property];
    }
  });

  // override referrer
  const originalReferrer = document.referrer;
  Object.defineProperty(document, 'referrer', {
    get: function () {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'document.referrer',
        stack: stack,
        init_invoke: "invoke",
        is_set: false,
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      return originalReferrer;
    }
  });

  // override screen.pixelDepth
  const originalPixelDepth = window.screen.pixelDepth;
  Object.defineProperty(window.screen, 'pixelDepth', {
    get: function () {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'screen.pixelDepth',
        stack: stack,
        init_invoke: "invoke",
        is_set: false,
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      return originalPixelDepth;
    }
  });

  // override screen.colorDepth
  const originalColorDepth = window.screen.colorDepth;
  Object.defineProperty(window.screen, 'colorDepth', {
    get: function () {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'screen.colorDepth',
        stack: stack,
        init_invoke: "invoke",
        is_set: false,
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      return originalColorDepth;
    }
  });

  // override AudioContext
  const originalAudioContext = window.AudioContext;
  window.AudioContext = function () {
    const stack = new Error().stack;
    const eventDetails = {
      functionName: 'AudioContext',
      stack: stack,
      init_invoke: "invoke",
      event_id: generateUUID(),
      eventTime: getCurrentDateTime(),
      site_id: window.measurement_data[0],
      site_url: window.measurement_data[1]
    };

    sendMessageToRedis(JSON.stringify(eventDetails));
    return new originalAudioContext();
  };

  // override webkitAudioContext
  const originalWebkitAudioContext = window.webkitAudioContext;
  window.webkitAudioContext = function () {
    const stack = new Error().stack;
    const eventDetails = {
      functionName: 'webkitAudioContext',
      stack: stack,
      init_invoke: "invoke",
      event_id: generateUUID(),
      eventTime: getCurrentDateTime(),
      site_id: window.measurement_data[0],
      site_url: window.measurement_data[1]
    };

    sendMessageToRedis(JSON.stringify(eventDetails));
    return new originalWebkitAudioContext();
  };

  // override offlineAudioContext
  const originalOfflineAudioContext = window.OfflineAudioContext;
  window.OfflineAudioContext = function () {
    const stack = new Error().stack;
    const eventDetails = {
      functionName: 'OfflineAudioContext',
      stack: stack,
      init_invoke: "invoke",
      event_id: generateUUID(),
      eventTime: getCurrentDateTime(),
      site_id: window.measurement_data[0],
      site_url: window.measurement_data[1]
    };

    sendMessageToRedis(JSON.stringify(eventDetails));
    return new originalOfflineAudioContext();
  };

  // override indexedDB
  const originalIndexedDB = window.indexedDB;
  window.indexedDB = new Proxy(originalIndexedDB, {
    get: function (target, property) {
      const stack = new Error().stack;
      const eventDetails = {
        functionName: 'indexedDB',
        property: property,
        stack: stack,
        is_set: false,
        init_invoke: "invoke",
        event_id: generateUUID(),
        eventTime: getCurrentDateTime(),
        site_id: window.measurement_data[0],
        site_url: window.measurement_data[1]
      };

      sendMessageToRedis(JSON.stringify(eventDetails));
      return target[property];
    }
  });
}

module.exports = {
  overrideJSFunctionsAndPropertiesStr: overrideJSFunctionsAndProperties.toString()
};
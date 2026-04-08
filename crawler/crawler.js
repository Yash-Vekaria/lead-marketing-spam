const puppeteer = require('puppeteer');
const fs = require('fs');
const csv = require('csv-parser');
const { format } = require('date-fns');
const sqlite3 = require('sqlite3');
const Promise = require('bluebird').Promise;

const crypto = require('crypto');
const LZString = require('lz-string');
const zlib = require('zlib');
const lzwCompress = require('lzwcompress');
const base32 = require('hi-base32');
const bs58 = require('bs58');
const { x86, x64 } = require('murmurhash3js-revisited');
const {
  md4,
  createSHA3,
  whirlpool } = require('hash-wasm');
const { overrideJSFunctionsAndPropertiesStr } = require('./overrides');


const tldjs = require('tldjs');
const { storeData, getDb, parseStackTrace, getDistinctThirdParties } = require('./helpers');
// const { overrideJSFunctionsAndPropertiesStr } = require('./overrides');
// const { interactWithPage } = require('./interactions');

const { getConfig, setDynamicConfig, getSensitiveStrings } = require('./configs');

let browser;


const Queue = require('bee-queue');

const queueInstances = {};
 

async function prepareQueues() {
  for (let i = 0; i < getConfig('redis_workers'); i++) {
    const wiretappingQueue = new Queue('wiretapping_queue_' + i, {
      redis: {
        host: getConfig('redis_ip'),
        port: getConfig('redis_port')
      }
    });
    // add to the queueInstances
    queueInstances[i] = wiretappingQueue;
  }
}
 

 
async function setupDatabase() {
  const db = new sqlite3.Database(getConfig('db_name'));
  db.serialize(() => {
    
    db.run(`CREATE TABLE IF NOT EXISTS requests (
      site_id integer, 
      site TEXT, 
      url TEXT, 
      method TEXT,   
      request_time TEXT, 
      headers TEXT,
      payload TEXT, 
      resourceType TEXT,  
      after_interaction TEXT, 
      current_url TEXT, 
      current_etld TEXT, 
      target_etld TEXT, 
      third_party INTEGER,
      data_leak_count INTEGER DEFAULT 0 ,
      data_leaks TEXT, 
      request_call_stack TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS dns_records (
      site_id integer,
      site TEXT,
      url TEXT,
      hostname TEXT,
      ip_address TEXT,
      record_type TEXT,
      ttl INTEGER,
      timestamp TEXT,
      request_id TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS responses (
      site_id integer, 
      site TEXT, 
      url TEXT, 
      response_code INTEGER,  
      response_time TEXT, 
      current_url TEXT, 
      current_etld TEXT, 
      target_etld TEXT, 
      third_party INTEGER,
      headers TEXT,
      content TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS event_listeners (
      site_id integer, 
      site TEXT, 
      event_type TEXT, 
      init_id text,
      init_invoke TEXT, 
      event_time TEXT, 
      event TEXT, 
      function TEXT, 
      useCapture TEXT, 
      args text, 
      stack text,
      stack_json TEXT,
      third_parties TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS removed_event_listeners (
      site_id integer, 
      site TEXT, 
      event_type TEXT, 
      init_invoke TEXT, 
      init_id text,
      event_time TEXT, 
      event TEXT, 
      function TEXT, 
      useCapture TEXT, 
      init_stack text,
      stack text,
      stack_json TEXT,
      third_parties TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS cookies (
      site_id TEXT,
      site_url TEXT,
      page_url TEXT,
      type TEXT,
      name TEXT,
      value TEXT,
      domain TEXT,
      path TEXT,
      expires TEXT,
      size INTEGER,
      httpOnly INTEGER,
      secure INTEGER,
      session INTEGER,
      UNIQUE(site_id, site_url, page_url, type, name, value, domain, path, expires, size, httpOnly, secure, session)
    );`);
    
    db.run(`CREATE TABLE IF NOT EXISTS storages (
      site_id TEXT,
      site_url TEXT,
      storage_type TEXT,
      frame_url TEXT,
      domain TEXT,
      key TEXT,
      value TEXT,
      db_name TEXT,
      store_name TEXT,
      timestamp TEXT,
      PRIMARY KEY (site_id, site_url, storage_type, frame_url, domain, key, db_name, store_name)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS callstacks (
      site_id integer,
      site TEXT,
      function TEXT,
      init_id text,
      init_invoke TEXT,
      event_type TEXT,
      stack TEXT,
      init_stack TEXT,
      stack_json TEXT,
      timestamp TEXT,
      value TEXT,
      is_set INTEGER DEFAULT 0,
      third_parties TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS interactions ( 
      site_id integer, 
      site_url TEXT, 
      start_time TEXT, 
      end_time TEXT, 
      interaction_type TEXT
    ); )`);

  });
  db.close();
}

function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time)
  });
}


async function generateVariations(str) {
  const inputBuffer = Buffer.from(str);
  const sha3_224 = await createSHA3(224);
  const sha3_256 = await createSHA3(256);
  const sha3_384 = await createSHA3(384);
  const sha3_512 = await createSHA3(512);

  return [
    // Original
    str,
    // Base64-Encoding
    inputBuffer.toString('base64'),
    // URL-Encoding
    encodeURIComponent(str),
    // LZ-String Compression
    LZString.compressToEncodedURIComponent(str),
    // LZW Compression
    JSON.stringify(lzwCompress.pack(str)),

    // Hashes
    crypto.createHash('md5').update(str).digest('hex'),
    crypto.createHash('sha1').update(str).digest('hex'),
    crypto.createHash('sha224').update(str).digest('hex'),
    crypto.createHash('sha256').update(str).digest('hex'),
    crypto.createHash('sha384').update(str).digest('hex'),
    crypto.createHash('sha512').update(str).digest('hex'),
    crypto.createHash('ripemd160').update(str).digest('hex'),      // RIPEMD160

    await md4(str),

    sha3_224.update(str).digest('hex'),
    sha3_256.update(str).digest('hex'),
    sha3_384.update(str).digest('hex'),
    sha3_512.update(str).digest('hex'),
    await whirlpool(str),

    // MurmurHash3
    x86.hash32(str),
    x64.hash128(str),

    // Base Encodings
    inputBuffer.toString('hex'),               // Base16
    base32.encode(str),                        // Base32
    bs58.encode(Buffer.from(str)),

    // Compress to Base64
    zlib.deflateSync(str).toString('base64'),
    zlib.deflateRawSync(str).toString('base64'),
    zlib.gzipSync(str).toString('base64'),
    zlib.brotliCompressSync(inputBuffer).toString('base64'),

    // Compress to HEX
    zlib.deflateSync(str).toString('hex'),
    zlib.gzipSync(str).toString('hex')
  ];
}

// this functions checks if the payload or the target URL contains any of the sensitive strings (data leak)
async function checkSensitiveData(payload, targetUrl, sensitiveData, siteId) {
  let data_leak_count = 0;
  const leakedAttributes = {};
  // console.log(`Checking sensitive data for site ID: ${siteId}, targetUrl: ${targetUrl}, sensitiveData: ${JSON.stringify(sensitiveData, null, 2)}`);
  const siteSensitiveStrings = sensitiveData[siteId];
  if (!siteSensitiveStrings) {
      // console.warn(`No sensitive data found for siteId: ${siteId}`);
      return { data_leak_count, leakedAttributes };
  }

  payload = payload || '';
  targetUrl = targetUrl || '';

  for (const [attr, variations] of Object.entries(siteSensitiveStrings)) {
      if (variations.some(v => payload.includes(v) || targetUrl.includes(v))) {
          data_leak_count += 1;
          leakedAttributes[attr] = variations.filter(v => payload.includes(v) || targetUrl.includes(v));
      }
  }
  return { data_leak_count, leakedAttributes: JSON.stringify(leakedAttributes) };
}

async function handleRequest(request, entry, page) {
  const [siteId, siteUrl, interactionFlag] = entry;
  const currentPageUrl = await page.url();
  const targetUrl = request.url();
  const requestInit = JSON.stringify(request.initiator());

  const currentEtld = tldjs.getDomain(currentPageUrl);
  const targetEtld = tldjs.getDomain(targetUrl);
  const thirdParty = currentEtld !== targetEtld ? 1 : 0;

  // Get DNS information
  const hostname = new URL(targetUrl).hostname;
  const requestId = request._requestId;
  
  try {
    const dns = require('dns');
    const dnsPromises = dns.promises;
    
    // Function to follow CNAME chain
    async function followCnameChain(domain) {
      const cnameChain = [];
      let currentDomain = domain;
      
      while (true) {
        try {
          const cnameRecords = await dnsPromises.resolveCname(currentDomain);
          if (cnameRecords && cnameRecords.length > 0) {
            cnameChain.push({
              domain: currentDomain,
              cname: cnameRecords[0]
            });
            currentDomain = cnameRecords[0];
          } else {
            break;
          }
        } catch (error) {
          if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') {
            break;
          }
          throw error;
        }
      }
      
      return {
        finalDomain: currentDomain,
        chain: cnameChain
      };
    }

    // First try to get CNAME chain
    try {
      const { finalDomain, chain } = await followCnameChain(hostname);
      
      // Store CNAME chain
      for (const record of chain) {
        await storeData("dns_records", [
          siteId,
          siteUrl,
          targetUrl,
          record.domain,
          record.cname,
          'CNAME',
          300,
          format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
          requestId
        ]);
      }

      // Now try to get A records for the final domain
      try {
        const addresses = await dnsPromises.lookup(finalDomain, { all: true });
        for (const address of addresses) {
          await storeData("dns_records", [
            siteId,
            siteUrl,
            targetUrl,
            finalDomain,
            address.address,
            address.family === 6 ? 'AAAA' : 'A',
            300,
            format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
            requestId
          ]);
        }
      } catch (aError) {
        // If A record lookup fails, store the error
        await storeData("dns_records", [
          siteId,
          siteUrl,
          targetUrl,
          finalDomain,
          `A_RECORD_ERROR: ${aError.message}`,
          'ERROR',
          0,
          format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
          requestId
        ]);
      }
    } catch (cnameError) {
      // If CNAME lookup fails, try direct A record lookup
      try {
        const addresses = await dnsPromises.lookup(hostname, { all: true });
        for (const address of addresses) {
          await storeData("dns_records", [
            siteId,
            siteUrl,
            targetUrl,
            hostname,
            address.address,
            address.family === 6 ? 'AAAA' : 'A',
            300,
            format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
            requestId
          ]);
        }
      } catch (aError) {
        // If both CNAME and A record lookups fail, store the error
        await storeData("dns_records", [
          siteId,
          siteUrl,
          targetUrl,
          hostname,
          `DNS_ERROR: ${cnameError.message}`,
          'ERROR',
          0,
          format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
          requestId
        ]);
      }
    }

    // Try to get NS records
    try {
      const nsRecords = await dnsPromises.resolveNs(hostname);
      for (const ns of nsRecords) {
        await storeData("dns_records", [
          siteId,
          siteUrl,
          targetUrl,
          hostname,
          ns,
          'NS',
          300,
          format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
          requestId
        ]);
      }
    } catch (nsError) {
      // Ignore NS errors as they're not critical
    }

    // Try to get SOA record
    try {
      const soaRecord = await dnsPromises.resolveSoa(hostname);
      await storeData("dns_records", [
        siteId,
        siteUrl,
        targetUrl,
        hostname,
        JSON.stringify(soaRecord),
        'SOA',
        soaRecord.refresh,
        format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
        requestId
      ]);
    } catch (soaError) {
      // Ignore SOA errors as they're not critical
    }

    // Try to get MX records
    try {
      const mxRecords = await dnsPromises.resolveMx(hostname);
      for (const mx of mxRecords) {
        await storeData("dns_records", [
          siteId,
          siteUrl,
          targetUrl,
          hostname,
          mx.exchange,
          'MX',
          mx.priority,
          format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
          requestId
        ]);
      }
    } catch (mxError) {
      // Ignore MX errors as they're not critical
    }

    // Try to get TXT records
    try {
      const txtRecords = await dnsPromises.resolveTxt(hostname);
      for (const txt of txtRecords) {
        await storeData("dns_records", [
          siteId,
          siteUrl,
          targetUrl,
          hostname,
          txt.join(''),
          'TXT',
          300,
          format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
          requestId
        ]);
      }
    } catch (txtError) {
      // Ignore TXT errors as they're not critical
    }

    // Try to get SRV records
    try {
      const srvRecords = await dnsPromises.resolveSrv(hostname);
      for (const srv of srvRecords) {
        await storeData("dns_records", [
          siteId,
          siteUrl,
          targetUrl,
          hostname,
          JSON.stringify({
            name: srv.name,
            port: srv.port,
            priority: srv.priority,
            weight: srv.weight
          }),
          'SRV',
          srv.priority,
          format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
          requestId
        ]);
      }
    } catch (srvError) {
      // Ignore SRV errors as they're not critical
    }

    // Try to get PTR records (reverse DNS)
    try {
      const addresses = await dnsPromises.lookup(hostname, { all: true });
      for (const address of addresses) {
        try {
          const ptrRecords = await dnsPromises.reverse(address.address);
          for (const ptr of ptrRecords) {
            await storeData("dns_records", [
              siteId,
              siteUrl,
              targetUrl,
              address.address,
              ptr,
              'PTR',
              300,
              format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
              requestId
            ]);
          }
        } catch (ptrError) {
          // Ignore PTR errors as they're not critical
        }
      }
    } catch (ptrError) {
      // Ignore PTR errors as they're not critical
    }

  } catch (error) {
    console.warn(`Could not get DNS information for request ${requestId}: ${error.message}`);
  }

  let payload = null;
  try {
    const postData = request.postData();
    if (postData) {
      payload = postData;
    }
  } catch (e) {
    console.error(e);
  }

  const resourceType = request.resourceType();
  const sensitiveStrings = await getSensitiveStrings();
  const { data_leak_count, leakedAttributes: data_leaks } = await checkSensitiveData(payload, targetUrl, sensitiveStrings, siteId);
  if (data_leak_count > 0) {
    console.log(`Leaked attributes: ${data_leaks}`);
  }
  const headers = request.headers();

  /*
  const requestCookie = headers['cookie'];
  if (requestCookie) {
    // const cookiesArray = requestCookie.split(/;\s);  // Cookies in request headers are separated by ";"

    cookiesArray.forEach(async (cookieStr) => {
      const [name, value] = cookieStr.split('=').map(v => v.trim());
      await storeData("cookies", [
        siteId,
        siteUrl,
        targetUrl,
        'HTTP COOKIE',
        name,
        value,
        new URL(targetUrl).hostname,
        '/',       // Path (unknown, default to '/')
        -1,        // Expires (unknown for request cookies)
        cookieStr.length,
        0,         // httpOnly unknown from request header
        0,         // secure unknown from request header
        1          // Assume session cookie
      ]);
      console.log(`✅ Saved HTTP Request cookie: ${name} from ${targetUrl}`);
    });
  }
  */

  try {
    const requestCookies = await page.cookies(targetUrl);
    for (const cookie of requestCookies) {
      await storeData("cookies", [
        siteId,
        siteUrl,
        targetUrl,
        'HTTP COOKIE',
        cookie.name,
        cookie.value,
        cookie.domain,
        cookie.path,
        cookie.expires !== -1 ? format(new Date(cookie.expires * 1000), 'yyyy-MM-dd HH:mm:ss.SSS') : null,
        cookie.name.length + cookie.value.length,
        cookie.httpOnly ? 1 : 0,
        cookie.secure ? 1 : 0,
        cookie.session ? 1 : 0
      ]);
      // console.log(`✅ Saved Request cookie: ${cookie.name} from ${targetUrl}`);
    }
  } catch (err) {
    // console.warn(`⚠️ Could not capture request cookies for ${targetUrl}: ${err.message}`);
  }

  // Continue storing request details as usual
  await storeData("requests", [
    siteId,
    siteUrl,
    targetUrl,
    request.method(),
    format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
    JSON.stringify(headers),
    payload,
    resourceType,
    interactionFlag,
    currentPageUrl,
    currentEtld,
    targetEtld,
    thirdParty,
    data_leak_count, 
    data_leaks,
    requestInit
  ]);
}


async function handleResponse(response, entry, page) {
  const [siteId, siteUrl] = entry;
  const currentPageUrl = await page.url(); // Get current page URL in real-time
  const targetUrl = response.url();
  const currentEtld = tldjs.getDomain(currentPageUrl);
  const targetEtld = tldjs.getDomain(targetUrl);
  const thirdParty = currentEtld !== targetEtld ? 1 : 0; // 1 for true, 0 for false
  const headers = response.headers();
  let content = '';
  const resourceType = response.request().resourceType();

  if (['document', 'script', 'stylesheet', 'xhr', 'fetch', 'other'].includes(resourceType)) {
    try {
      content = await response.text();
    } catch (err) {
      // console.warn(`⚠️ Could not retrieve content for ${targetUrl}: ${err.message}`);
      content = '';
    }
  } else {
    // console.log(`ℹ️ Skipped content capture for resource type ${resourceType}: ${targetUrl}`);
  }

  await storeData("responses", [
    siteId,
    siteUrl,
    targetUrl,
    response.status(),
    format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS'),
    currentPageUrl,
    currentEtld,
    targetEtld,
    thirdParty,
    JSON.stringify(headers),
    content
  ]);

  const setCookie = headers['set-cookie'];
  if (setCookie) {
    const cookiesArray = setCookie.split(/\n|,(?=\s*\w+=)/);  // Handles multiple cookies

    cookiesArray.forEach(async (cookieStr) => {
      const parsedCookie = parseCookie(cookieStr);
      const formattedExpires = parsedCookie.expires && parsedCookie.expires !== -1
        ? format(new Date(parsedCookie.expires), 'yyyy-MM-dd HH:mm:ss.SSS')
        : null;
      await storeData("cookies", [
        entry[0],
        entry[1],
        response.url(),
        'HTTP SET-COOKIE',
        parsedCookie.name,
        parsedCookie.value,
        parsedCookie.domain || new URL(response.url()).hostname,
        parsedCookie.path || '/',
        formattedExpires, // parsedCookie.expires || -1,
        cookieStr.length,
        parsedCookie.httpOnly ? 1 : 0,
        parsedCookie.secure ? 1 : 0,
        parsedCookie.session ? 1 : 0
      ]);
      // console.log(`✅ Saved HTTP cookie: ${parsedCookie.name} from ${response.url()}`);
    });
  }
}


function parseCookie(cookieStr) {
  const cookie = {};
  const parts = cookieStr.split(';').map(part => part.trim());

  parts.forEach((part, index) => {
    const [key, ...valParts] = part.split('=');
    const val = valParts.join('=');
    if (index === 0) {
      cookie.name = key;
      cookie.value = val;
    } else {
      const lowerKey = key.toLowerCase();
      switch (lowerKey) {
        case 'expires':
          cookie.expires = Date.parse(val) || -1;
          break;
        case 'domain':
          cookie.domain = val;
          break;
        case 'path':
          cookie.path = val;
          break;
        case 'secure':
          cookie.secure = true;
          break;
        case 'httponly':
          cookie.httpOnly = true;
          break;
        case 'samesite':
          cookie.sameSite = val;
          break;
        default:
          break;
      }
    }
  });

  cookie.session = !('expires' in cookie);
  return cookie;
}
    
async function captureJSCookies(page, entry) {
  if (page.isClosed()) return;
  try {
    const cookies = await page.evaluate(() => document.cookie);
    if (cookies) {
      const cookiesArray = cookies.split(';').map(c => c.trim());
      for (const cookieStr of cookiesArray) {
        const [name, value] = cookieStr.split('=');
        const cookieData = [
          entry[0],
          entry[1],
          page.url(),
          'Javascript',
          name,
          value,
          new URL(page.url()).hostname,
          '/',
          -1,
          cookieStr.length,
          0,
          0,
          1
        ];

        await storeData("cookies", cookieData);
        // console.log(`✅ Saved new JS cookie: ${name} from ${page.url()}`);
      }
    }
  } catch (e) {
    if (!page.isClosed()) {
      console.error("Error capturing JS cookies:", e.message);
    }
  }
}



async function captureAllFrameStorages(page, entry) {
  if (page.isClosed()) return;
  const [siteId, siteUrl] = entry;
  const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS');

  for (const frame of page.frames()) {
    // if (frame.isDetached() || !frame.url().startsWith('http')) {
    if (frame.isDetached()) {
      continue;
    }

    let frameUrl = 'unknown';
    let frameOrigin = 'unknown';
    try {
      const urlObj = new URL(frame.url());
      frameUrl = urlObj.href;
      frameOrigin = urlObj.hostname;
      // pageOrigin = await frame.evaluate(() => window.origin);
    } catch (err) {
      if (!err.message.includes('Execution context was destroyed') && !err.message.includes('Protocol error') && !err.message.includes('frameUrl is not defined')) {
        // console.warn(`⚠️ Could not get origin for frame URL ${frame.url()}: ${err.message}`);
      }
      continue; // skip if origin inaccessible (rare cross-origin issue)
    }

    try {
      const storageData = await frame.evaluate(() => {
        const getItems = (storage) => {
          const items = [];
          for (let i = 0; i < storage.length; i++) {
            items.push({ key: storage.key(i), value: storage.getItem(storage.key(i)) });
          }
          return items;
        };

        return {
          localStorage: getItems(window.localStorage),
          sessionStorage: getItems(window.sessionStorage)
        };
      });

      // console.log(`Frame URL: ${frame.url()}, localStorage: ${JSON.stringify(storageData.localStorage)}, sessionStorage: ${JSON.stringify(storageData.sessionStorage)}`);
      // console.log(`[+] localStorage/sessionStorage data for frame: ${frame.url()}`, storageData);

      for (const { key, value } of storageData.localStorage) {
        // console.log(`localStorage key: ${key}, value: ${value}`);
        try {
          await storeData("storages", [
            siteId, siteUrl, "localStorage", frameUrl, frameOrigin, key, value, null, null, timestamp
          ]);
        } catch (e) {
          console.error(`Error storing localStorage key ${key}: ${e.message}`);
        }
      }

      for (const { key, value } of storageData.sessionStorage) {
        // console.log(`sessionStorage key: ${key}, value: ${value}`);
        try {
          await storeData("storages", [
            siteId, siteUrl, "sessionStorage", frameUrl, frameOrigin, key, value, null, null, timestamp
          ]);
        } catch (e) {
          console.error(`Error storing sessionStorage key ${key}: ${e.message}`);
        }
      }
    } catch (err) {
      if (!frame.isDetached() && !err.message.includes('frameUrl is not defined')) {
        // console.warn(`⚠️ Storage extraction failed for frame ${frame.url()}: ${err.message}`);
      }
    }

    try {
      const indexedDBData = await frame.evaluate(async () => {
        const databases = await indexedDB.databases();
        const results = [];

        for (const dbInfo of databases) {
          if (!dbInfo.name) continue;
          const request = indexedDB.open(dbInfo.name);
          const db = await new Promise((resolve, reject) => {
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });

          for (const storeName of db.objectStoreNames) {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const allKeysReq = store.getAllKeys();
            const allValuesReq = store.getAll();

            const [keys, values] = await Promise.all([
              new Promise((res, rej) => {
                allKeysReq.onsuccess = () => res(allKeysReq.result);
                allKeysReq.onerror = () => rej(allKeysReq.error);
              }),
              new Promise((res, rej) => {
                allValuesReq.onsuccess = () => res(allValuesReq.result);
                allValuesReq.onerror = () => rej(allValuesReq.error);
              })
            ]);

            keys.forEach((key, idx) => {
              results.push({
                db_name: dbInfo.name,
                store_name: storeName,
                key: JSON.stringify(key),
                value: JSON.stringify(values[idx])
              });
            });
          }
          db.close();
        }

        return results;
      });

      for (const { db_name, store_name, key, value } of indexedDBData) {
        await storeData("storages", [
          siteId, siteUrl, "IndexedDB", frameUrl, frameOrigin, key, value, db_name, store_name, timestamp
        ]);
      }
    } catch (err) {
      if (!frame.isDetached() && !err.message.includes('frameUrl is not defined')) {
        // console.warn(`⚠️ IndexedDB extraction failed for frame ${frame.url()}: ${err.message}`);
      }
    }
  }
}


async function setupCDPStorageListeners(client, entry) {
  const [siteId, siteUrl] = entry;

  client.on('DOMStorage.domStorageItemAdded', async event => {
    const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS');
    await storeData("storages", [
      siteId, siteUrl,
      event.storageId.isLocalStorage ? 'localStorage' : 'sessionStorage',
      event.storageId.securityOrigin,
      (new URL(event.storageId.securityOrigin)).hostname,
      event.key, event.newValue, null, null, timestamp
    ]);
  });

  client.on('DOMStorage.domStorageItemUpdated', async event => {
    const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS');
    await storeData("storages", [
      siteId, siteUrl,
      event.storageId.isLocalStorage ? 'localStorage' : 'sessionStorage',
      event.storageId.securityOrigin,
      (new URL(event.storageId.securityOrigin)).hostname,
      event.key, event.newValue, null, null, timestamp
    ]);
  });

  client.on('Storage.indexedDBListUpdated', async event => {
    const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS');
    for (const origin of event.origins) {
      const { databases } = await client.send('Storage.getIndexedDBDatabaseNames', { securityOrigin: origin });
      for (const dbName of databases) {
        const { objectStores } = await client.send('Storage.getIndexedDBMetadata', { securityOrigin: origin, databaseName: dbName });
        for (const store of objectStores) {
          const { entries } = await client.send('Storage.requestIndexedDBData', {
            securityOrigin: origin,
            databaseName: dbName,
            objectStoreName: store.name,
            skipCount: 0,
            pageSize: 100
          });
          for (const entryItem of entries) {
            await storeData("storages", [
              siteId, siteUrl, "IndexedDB",
              origin, (new URL(origin)).hostname,
              JSON.stringify(entryItem.key), JSON.stringify(entryItem.value),
              dbName, store.name, timestamp
            ]);
          }
        }
      }
    }
  });
}






let jsCookiesInterval = null;
let frameStoragesInterval = null;
const EXT1 = '/Users/yvekaria/Documents/Research/Leads-Tech-Policy/2025-lead-ecosystem/crawler/extensions/html-elements-screenshot';
const EXT2 = '/Users/yvekaria/Documents/Research/Leads-Tech-Policy/2025-lead-ecosystem/crawler/extensions/website-downloader';
const EXT_ALL = `${EXT1},${EXT2}`;


async function startCrawler(urls) {
  try {
    let page;
    console.log('Starting crawler...');
    console.log(urls)

    for (const entry of urls) {

      const siteURL = entry[1];
      const siteID = entry[0];
      if (siteID.split('_')[1] > getConfig('max_subpage')) {
        continue;
      }

      if (getConfig('dont_use_list_sites')) {
        entry[0] = -1
        entry[1] = getConfig('static_site_url');
      }
      
      console.log(`Processing site ID ${siteID} with URL: ${siteURL}`)
      browser = await puppeteer.launch({
        headless: false,
        args: [
          // '--disable-web-security',
          // '--disable-site-isolation-trials',
          `--disable-extensions-except=${EXT_ALL}`,
          `--load-extension=${EXT_ALL}`,
          '--start-maximized'
        ],
        protocolTimeout: getConfig("timeout_site"),
        userDataDir: `./browser_data/${process.argv[2]}`,
      });

      // Handle new tabs/popups
      browser.on('targetcreated', async (target) => {
        if (target.type() === 'page') {
          try {
            const newPage = await target.page();
            const entryCopy = [...entry]; // Clone entry so it's stable

            console.log(`[+] New tab listening: ${await newPage.url()}`);

            // await newPage.setViewport({ width: 1920, height: 1080 });
            await newPage.setViewport({ width: 1080, height: 800 });
            await newPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');

            const client = await newPage.target().createCDPSession();
            await client.send('Network.enable');
            await client.send('Debugger.enable');
            await client.send('DOMStorage.enable');
            await setupCDPStorageListeners(client, entry);
            
            await newPage.evaluateOnNewDocument((entry) => {
              window.measurement_data = entry;
            }, entryCopy);
  

            await newPage.evaluateOnNewDocument(new Function(`(${overrideJSFunctionsAndPropertiesStr})()`));

            newPage.on('request', req => handleRequest(req, entryCopy, newPage));
            newPage.on('response', res => handleResponse(res, entryCopy, newPage));
            
            await newPage.exposeFunction('sendToQueue', async (message) => {
              const jobData = { message: message };
              wiretappingQueue = queueInstances[Math.floor(Math.random() * getConfig('redis_workers'))];
              const job = wiretappingQueue.createJob(jobData);
              try {
                const savedJob = await job.save();
                //console.log(`Event is queued with ID: ${savedJob.id}`);
              } catch (err) {
                console.error('Error creating job:', err);
              }
            });

            await newPage.evaluateOnNewDocument(() => {
              window.sendToQueue = window.sendToQueue || function (message) {
                if (typeof window.sendToQueue === 'function') {
                  window.sendToQueue(message);
                }
              };
            });
  

            page.on('request', request => handleRequest(request, entry, page));
            page.on('response', response => handleResponse(response, entry, page));
  
          } catch (err) {
            console.warn("⚠️ Could not attach to new tab:", err.message);
          }
        }
      });
      
      const page = await browser.newPage();
      
      await page.setViewport({
        width: 1080, // 1920,
        height: 800
      });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');
      
      const client = await page.target().createCDPSession();
      await client.send('Network.enable');
      await client.send('Debugger.enable');
      await client.send('DOMStorage.enable');
      await setupCDPStorageListeners(client, entry);
      
      // make a global variable to store the site id
      await page.evaluateOnNewDocument((entry) => {
        window.measurement_data = entry;
      }, entry);


        // we are exposing the sendToQueue function to the page (to send the data later to redis)
        await page.exposeFunction('sendToQueue', async (message) => {
          const jobData = { message: message };
          // wiretappingQueue = await getQueueInstance(siteID);
          // get random queueinstance between 0 and redis_worker
          wiretappingQueue = queueInstances[Math.floor(Math.random() * getConfig('redis_workers'))];
          // console.log("I GOT_________________________________:" + Math.floor(Math.random() * getConfig('redis_workers')))

          const job = wiretappingQueue.createJob(jobData);
          try {
            const savedJob = await job.save();
            //console.log(`Event is queued with ID: ${savedJob.id}`);
          } catch (err) {
            console.error('Error creating job:', err);
          }
        });

        await page.evaluateOnNewDocument(() => {
          window.sendToQueue = window.sendToQueue || function (message) {
            if (typeof window.sendToQueue === 'function') {
              window.sendToQueue(message);
            }
          };
        });
 


        page.on('request', request => handleRequest(request, entry, page));
        page.on('response', response => handleResponse(response, entry, page));
  
      
      jsCookiesInterval = null;
      frameStoragesInterval = null;
      
      try {
        console.log(`${format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS')} - Navigating to page: ${entry[0]} (${entry[1]})`);
        ;
        // Navigate to the page with a 'load' event wait condition
        const domReadyCheckPromise = new Promise((resolve) => setTimeout(() => resolve('domNotReady'), getConfig("dom_ready_wait_time")));
        const navigationPromise = page.goto(siteURL, {
          waitUntil: 'load',
          timeout: getConfig("dom_ready_wait_time")
        }).catch(e => {
          console.error(`${format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS')} - Timeout during navigation to ${siteID}: ${e}`);
        });
        
        // Race between navigation and 5-second timeout
        const navigationResult = await Promise.race([navigationPromise, domReadyCheckPromise]);
        if (navigationResult === 'domNotReady') {
          console.warn(`${format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS')} - DOM not ready within ${getConfig("dom_ready_wait_time")} for ${siteID}.`);
        }

        // Periodically capture Javascript cookies every second
        jsCookiesInterval = setInterval(() => captureJSCookies(page, entry), 1000);

        // Periodically capture localStorage, sessionStorage, and indexedDB cookies every second
        frameStoragesInterval = setInterval(() => captureAllFrameStorages(page, entry), 250);

      } catch (e) {
        console.error(`${format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS')} - Failed to process ${entry[1]}: ${e}`);
      }
    }

  }
  catch (e) {
    console.log('\x1b[41m%s\x1b[0m', "unhandled error : " + e.message);
  }
}

const flattenedChunk = [[process.argv[2], process.argv[3]]];

(async () => {

  if (process.argv.length !== 4) {
    console.error('\x1b[31m%s\x1b[0m', '❌ Missing arguments.\nUsage: node crawler.js <site_id> <site_url>');
    process.exit(1);
  } 
  
  try {
    await prepareQueues();
  }
  catch (e) {
    console.log('\x1b[41m%s\x1b[0m', "error during preparing queues - without redis I cannot work: " + e.message);
    // throw e;
  }
 

  const siteURL = process.argv[3];
  const siteHostClean = siteURL
    .replace(/^https?:\/\//, '')      // remove protocol
    .replace(/[^\w.-]/g, '_');        // make filesystem-safe
  const dbPath = `measurement_data/${siteHostClean}.db`;

  setDynamicConfig('db_name', dbPath);

  // Ensure measurement_data directory exists
  if (!fs.existsSync('measurement_data')) {
    fs.mkdirSync('measurement_data');
  }

  console.log('\x1b[36m%s\x1b[0m', '⚠️  When completing, use CTRL + C to exit, otherwise cookies WILL NOT BE SAVED!');

  const flattenedChunk = [[process.argv[2], process.argv[3]]];
  await setupDatabase();
  await startCrawler(flattenedChunk);

})();


process.on('SIGINT', async () => {
  console.log("\nGracefully shutting down...");

  if (jsCookiesInterval) clearInterval(jsCookiesInterval);
  if (frameStoragesInterval) clearInterval(frameStoragesInterval);

  if (browser) {
    await browser.close();
  }
  process.exit();
});
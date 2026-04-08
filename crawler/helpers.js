const { open } = require('sqlite');
const { parse } = require('tldts');
const sqlite3 = require('sqlite3');
const { getConfig } = require('./configs');
const path = require('path');

let db;
async function getDb(isRedis) {
  if (isRedis === true) {
    db_path = getConfig('db_name_redis');
  }
  else {
    db_path = getConfig('db_name');
  }

  if (!db) {
    db = await open({
      filename: db_path,
      driver: sqlite3.Database
    });
    await db.run(`PRAGMA busy_timeout = 5000;`); // Set a busy timeout of 5000 milliseconds
  }
  return db;
}

async function pushToBigQuery(rows, tbl) {


  const credentialsPath = path.join(__dirname, 'helpers', 'google.json');

  const { BigQuery } = require('@google-cloud/bigquery');
  const bigquery = new BigQuery({ keyFilename: credentialsPath });
  try {
    // Prepare the dataset and table reference
    const dataset = bigquery.dataset('wiretapping');
    const table = dataset.table(tbl);

    // Insert the rows into the BigQuery table
    const [insertErrors] = await table.insert(rows);

    // Check for any errors during insertion
    if (insertErrors && insertErrors.length > 0) {
      console.error('Insert errors:', insertErrors);
    } else {
      console.log('Data successfully inserted into BigQuery.');
    }
  } catch (error) {
    console.error('Error inserting data into BigQuery:', error);
  }
}

async function storeData(table, data) {
  let isRedis = false;
  if (table === 'event_listeners' || table === 'removed_event_listeners' || table === 'callstacks') {
    isRedis = true;
  }

  const db = await getDb(isRedis);

  // Ensure `data` is an array of arrays (each sub-array is a row)
  if (!Array.isArray(data[0])) {
    data = [data]; // If it's a single row, convert it to an array of arrays
  }

  const placeholders = data.map(row => `(${row.map(() => '?').join(', ')})`).join(', ');  // Create placeholders for each row
  let query;
  if (table === 'cookies') {
    query = `INSERT OR IGNORE INTO ${table} VALUES ${placeholders}`;
  } else if (table === 'storages') {
    // Checking uniqueness based on all columns except 'timestamp' to avoid duplicates
    query = `
    INSERT INTO storages (site_id, site_url, storage_type, frame_url, domain, key, value, db_name, store_name, timestamp)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM storages WHERE 
        site_id = ? AND
        site_url = ? AND
        storage_type = ? AND
        frame_url = ? AND
        domain = ? AND
        key = ? AND
        value = ? AND
        ((db_name IS NULL AND ? IS NULL) OR (db_name = ?)) AND
        ((store_name IS NULL AND ? IS NULL) OR (store_name = ?))
    )`;
  } else {
    query = `INSERT INTO ${table} VALUES ${placeholders}`;
  }

  const flatData = data.flat();  // Flatten the data to provide values for all rows

  let attempts = 0;
  const maxAttempts = 6; // Try the original attempt + 5 retries

  while (attempts < maxAttempts) {
    try {
      if (table === 'storages') {
        for (const row of data) {
          const sanitizedFrameUrl = row[3].replace(/\/+$/, '');
          const sanitizedRow = [...row];
          sanitizedRow[3] = sanitizedFrameUrl; // Triming the trailing slashes
          await db.run(query, [
            ...sanitizedRow,                                      // First set for insert
            row[0], row[1], row[2], sanitizedFrameUrl, row[4],    // site_id, site_url, storage_type, frame_url, domain
            row[5], row[6],                                       // key, value
            row[7], row[7],                                       // db_name IS ? OR db_name = ?
            row[8], row[8]                                        // store_name IS ? OR store_name = ?
          ]);
        }
      } else {
        await db.run(query, flatData); // Pass the flat array of values for the query
      }
      return; // If successful, exit the function
    } catch (err) {
      if (err.message.includes('database is locked') && attempts < maxAttempts - 1) {
        console.log(`Database is locked, retrying in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Sleep for 2 seconds
      } else {
        console.error(`Error storing data in ${table}: ${err.message}`);
        break; // If a different error or max attempts reached, exit the loop
      }
    }
    attempts++;
  }
}

// beautify the stack trace
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
  return JSON.stringify(details); // Convert the array of details to a JSON string
}



function getDistinctThirdParties(stack, first_party_url) {
  const details = JSON.parse(stack);
  const thirdParties = [];

  // Extract the eTLD+1 from the first party URL
  const firstPartyDomain = parse(first_party_url).domain;

  for (const detail of details) {
    const { scriptUrl } = detail;

    // Extract the eTLD+1 from each script URL in the stack trace
    const scriptDomain = parse(scriptUrl).domain;

    // Check if the script domain is a third party and unique, then add it to the list
    if (scriptDomain && scriptDomain !== firstPartyDomain && !thirdParties.includes(scriptDomain)) {
      thirdParties.push(scriptDomain);
    }
  }

  // Return a comma-separated string of unique third-party domains, or null if there are none
  return thirdParties.length === 0 ? null : thirdParties.join(',');
}





// identify if stack trace contains a third-party eTLD using tldjs, input is always like 
function stackHasThirdParty(stack, first_party) {
  const details = JSON.parse(stack);
  for (const detail of details) {
    const { scriptUrl } = detail;
    const { domain } = tldjs.parse(scriptUrl);
    if (domain && domain !== first_party) {
      return true;
    }
  }
  return false;
}



module.exports = {
  storeData,
  getDb,
  parseStackTrace,
  stackHasThirdParty,
  getDistinctThirdParties,
  pushToBigQuery
};
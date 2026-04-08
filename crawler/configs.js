const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');
const os = require('os');
let dynamicParams = {};


function generateVariations(attr, value) {
    const variations = [];
  
    if (attr === 'DOB') {
        const [month, day, year] = value.split(/[\/\-]/);
        variations.push(
        `${month}/${day}/${year}`,
        `${day}/${month}/${year}`,
        `${month}-${day}-${year}`,
        `${day}-${month}-${year}`
        );
    } else if (attr === 'Phone') {
        // include phone number variations as "404 232 6320", "4042326320", "404-232-6320", "(404)232-6320", "(404) 232-6320"
        variations.push(
            value,                                                       // "XXX XXX XXXX"
            value.replace(/[\s()-]/g, ''),                               // "XXXXXXXXXX"
            value.replace(/\s/g, '-'),                                   // "XXX-XXX-XXXX"
            value.replace(/^(\d{3})\s*(\d{3})\s*(\d{4})$/, '($1)$2-$3'), // "(XXX)XXX-XXXX"
            value.replace(/^(\d{3})\s*(\d{3})\s*(\d{4})$/, '($1) $2-$3') // "(XXX) XXX-XXXX"
        );
    } else {
        variations.push(value);
    }
  
    return variations;
}


async function loadSensitiveStrings() {
    
    const csvFilePath = path.join(__dirname, 'form_data', 'form_inputs.csv');
    const allowedAttributes = [
        'FirstName', 'LastName', 'Email', 'Phone', 'Zip', 'DOB', 'Address', 'Street', 'City'
    ];

    return new Promise((resolve, reject) => {
        const results = {};
        fs.createReadStream(csvFilePath)
        .pipe(csv())
        .on('data', (data) => {
            const siteId = data.SiteID;
            results[siteId] = {};

            allowedAttributes.forEach(attr => {
            const value = data[attr];
            results[siteId][attr] = generateVariations(attr, value);
            });
        })
        .on('end', () => resolve(results))
        .on('error', reject);
    });
}


function getConfig(name) {
    const params = {
        // debugging options
        do_not_close_browser: false,
        do_not_close_page: false,
        dont_use_list_sites: false,

        // general options 
        // url_list: "lists/data_leakers.csv",
        db_name: dynamicParams.db_name || "measurement_data/crawler_data.db",
        db_name_redis: "measurement_data/crawler_data_redis.db",
        timeout_site: 90000, // total life of a single site crawling
        timeout_interactions: 82000,
        dom_ready_wait_time: 10000,
        redis_ip: "127.0.0.1",
        redis_port: 6379,
        redis_workers: 5,

        //sensitiveStrings
        sensitiveStrings: [
            'velisiteID@gmail.com',
            '4922122200',
            'SaltySeedsTea9!',
            'hi_my_honey_text',
            'curious-cat.com',
            'https://curious-cat.com',
            'my_funny_honey',
            'hi_my_honey_field'
        ]
    };
    return params[name];
}

async function getSensitiveStrings() {
    try {
        const sensitiveStrings = await loadSensitiveStrings();
        return sensitiveStrings;
    } catch (err) {
        console.error('Error loading sensitive strings:', err);
        return {};
    }
}

function setDynamicConfig(name, value) {
    dynamicParams[name] = value;
}


module.exports = {
    getConfig,
    setDynamicConfig,
    getSensitiveStrings
};
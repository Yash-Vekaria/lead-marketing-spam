const Queue = require('bee-queue');
const { storeData, getDb, parseStackTrace, getDistinctThirdParties } = require('./helpers');
const { getConfig } = require('./configs');


const queueNames = Array.from({ length: getConfig('redis_workers') }, (_, i) => `wiretapping_queue_${i}`);

// Buffer arrays for each worker
const workerBuffers = {};
const bufferTimers = {};
const MAX_BUFFER_SIZE = 100;
const BUFFER_FLUSH_TIMEOUT = 20000;

// Initialize buffers for each worker based on getConfig('redis_workers')
for (let i = 0; i < getConfig('redis_workers'); i++) {
    workerBuffers[`worker_${i}`] = [];
    bufferTimers[`worker_${i}`] = null;
}

// New function to handle message buffering and bulk insert
async function bufferAndInsert(workerId, table, row) {
    const buffer = workerBuffers[`worker_${workerId}`];

    buffer.push(row); // Add the message to the worker's buffer

    // Clear existing timer if new data comes in
    if (bufferTimers[`worker_${workerId}`]) {
        clearTimeout(bufferTimers[`worker_${workerId}`]);
    }

    // If buffer reaches max size, insert immediately
    if (buffer.length >= MAX_BUFFER_SIZE) {
        try {
            await storeData(table, buffer);
            workerBuffers[`worker_${workerId}`] = []; // Clear the buffer after insertion
        } catch (error) {
            console.error(`Error inserting data for worker ${workerId}: ${error.message}`);
        }
    } else {
        // If buffer doesn't reach max size, set a timeout to flush after 10 seconds
        bufferTimers[`worker_${workerId}`] = setTimeout(async () => {
            if (buffer.length > 0) {
                try {
                    await storeData(table, buffer);
                    workerBuffers[`worker_${workerId}`] = []; // Clear the buffer after insertion
                    // add date time to the console
                    console.log(`[${table}] Buffer flushed after timeout. ${new Date().toISOString()}`);
                } catch (error) {
                    console.error(`Error inserting data for worker ${workerId} after timeout: ${error.message}`);
                }
            }
        }, BUFFER_FLUSH_TIMEOUT);
    }
}


async function processQueue(queueName, workerId) {
    const queue = new Queue(queueName, {
        redis: {
            host: '127.0.0.1',
            port: 6379,
            removeOnSuccess: true
        }
    });

    queue.process(async (job) => {
        const messageData = JSON.parse(job.data['message']);

        const date = new Date();
        try {
            const waiting = await queue.getJobs('waiting');
            process.stdout.write(`\r[${queueName}] Fetching job counts - remaining: ${waiting.length}`);
            if (waiting.length === 0) {
                // print date
                console.log(`\n[${queueName}] No more jobs in the queue. ${date.toISOString()}`);
            }
        } catch (error) {
            console.error(`[${queueName}] Error fetching job counts:`, error);
        }

        await processQueueMessage(messageData, workerId); // Pass workerId
        return `Processed message: ${job.data.message}`;
    });

    queue.on('ready', () => {
        console.log(`[${queueName}] Consumer is ready to process jobs...`);
    }).on('error', (err) => {
        console.error(`[${queueName}] Consumer encountered an error:`, err);
    });
}


// testQueue.process(async (job) => {
//     const messageData = JSON.parse(job.data['message']);

//     try {
//         const waiting = await testQueue.getJobs('waiting');
//         process.stdout.write(`\rFetching job counts, please be patient! - remaining: ${waiting.length} +`);
//         if (waiting.length == 0) {
//             console.log('\nNo more jobs in the queue, you can stop the consumer now!');
//         }
//     } catch (error) {
//         console.error('Error fetching job counts:', error);
//     }

//     await processQueueMessage(messageData); // Await the processing of the message
//     return `Processed message: ${job.data.message}`;
// });


// testQueue.on('ready', () => {
//     console.log('Consumer is ready to process jobs...');
// }).on('error', (err) => {
//     console.error('Consumer encountered an error:', err);
// });



async function processQueueMessage(message, workerId) {

    override_type = message['override_type'];

    const data = message
    const siteId = message.site_id;
    const siteUrl = message.site_url;
    const text = override_type || '';

    if (text.includes("AddEventListener") || text.includes("RemoveEventListener")) {
        try {
            // const data = JSON.parse(text.substring(text.indexOf(':') + 2)); // Parse JSON direkt aus dem Log
            const eventType = data.type;
            const functionContent = data.function || 'Function content unavailable';
            const useCapture = data.useCapture; // Kann undefined sein, wenn nicht im Log vorhanden
            const stack = data.stack || 'Stack trace unavailable'; // Extrahiere den Stack-Trace
            const init_invoke = data.init_invoke;
            const init_stack = data.init_stack;
            const event_id = data.event_id;
            const event_time = data.eventTime;
            stack_json = parseStackTrace(stack);

            const table = text.includes("AddEventListener") ? "event_listeners" : "removed_event_listeners";

            row = [
                siteId,
                siteUrl,
                eventType,
                event_id,
                init_invoke,
                event_time,
                text,
                functionContent,
                useCapture ? useCapture.toString() : 'false',
                init_stack,
                stack,
                stack_json,
                getDistinctThirdParties(stack_json, siteUrl)
            ]
            // store the data 
            // storeData(table, row);

            await bufferAndInsert(workerId, table, row);

        } catch (e) {
            console.error(`Error processing console message: ${e.message}`);
            console.error(`Original message: ${text}`);
        }
    } else {
        try {
            // Extract the JSON part of the message
            // const jsonPart = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
            // const data = JSON.parse(jsonPart); // Parse the JSON data

            // Extract details from the parsed JSON
            const {
                event_id,
                functionName,
                callback,
                init_invoke,
                stack,
                eventTime,
                init_stack,
                value,
                is_set
            } = data;

            stack_json = parseStackTrace(stack);

            row = [
                siteId,
                siteUrl,
                callback,
                event_id,
                init_invoke,
                functionName,
                stack,
                init_stack,
                stack_json,
                eventTime,
                value,
                is_set,
                getDistinctThirdParties(stack_json, siteUrl)
            ]
            // store the data 
            // storeData("callstacks",row );


            await bufferAndInsert(workerId, "callstacks", row);
        } catch (e) {
            console.error(`Error processing console message for custom override: ${e.message}`);
            console.error(`Original message: ${text}`);
        }
    }
    // Capture and store stack traces
    // Re-visit: seems to be deprecated
    if (text.includes('Event triggered')) {
        const eventType = text.split(',')[0].split(':')[1].trim();
        const stack = text.split('Stack:')[1].trim();
        const requestUrl = await page.evaluate(() => window.location.href); // Get the current page URL
        const timestamp = format(new Date(), 'yyyy-MM-dd HH:mm:ss.SSS');

        storeData("callstacks", [
            siteId, siteUrl, requestUrl, eventType, stack, timestamp
        ]);
    }
}
 
// Process all queues in parallel using Promise.all
(async () => {
    await Promise.all(
        queueNames.map((queueName, index) => processQueue(queueName, index)) // Pass index as workerId
    );
})();

import { mainWithCredentials } from './mainWithCredentials.js';
import { readCsv, writeToCSV, delay } from './helperFunctions.js';
import path from 'path';
import fs from 'fs';

/**
 * Processes multiple credentials concurrently with a limit on parallel operations
 * @param {string} inputFilePath - Path to the CSV file with credentials
 * @param {number} maxConcurrent - Maximum number of concurrent operations
 */
async function processCredentialsConcurrently(inputFilePath, maxConcurrent = 1) { // Changed to 1 for debugging
    try {
        console.log(`Reading input file: ${inputFilePath}`);
        const credentials = await readCsv(inputFilePath);
        console.log(`Processing ${credentials.length} credentials with ${maxConcurrent} concurrent workers...`);

        // Create output directory if it doesn't exist
        const outputDir = path.resolve('./results');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const successPath = path.join(outputDir, 'success.csv');
        const failedPath = path.join(outputDir, 'failed.csv');

        // Create thread-safe arrays for results
        const successes = [];
        const failures = [];
        
        // Create a thread-safe queue
        const queue = [...credentials];
        let activeWorkers = 0;
        let completed = 0;
        const total = queue.length;

        async function worker(workerId) {
            while (queue.length > 0) {
                // Atomically get the next task
                const credential = queue.shift();
                if (!credential) break;  // Exit if queue is empty
                
                activeWorkers++;
                const { email, password, proxy_str, twofa } = credential;

                console.log(`\n=== [Worker ${workerId}] Starting task for ${email} ===`);
                console.log(`Active: ${activeWorkers}/${maxConcurrent}, Completed: ${completed}/${total}`);
                console.log(`Credential details:`, { email, proxy_str, twofa: twofa ? '***PROVIDED***' : 'MISSING' });

                try {
                    const result = await mainWithCredentials(email, password, proxy_str, twofa);

                    if (result.success) {
                        console.log(`✅ [Worker ${workerId}] Task succeeded for ${email}.`);
                        // Store successful result
                        successes.push({ email, password, proxy_str, twofa });
                    } else {
                        console.error(`❌ [Worker ${workerId}] Task failed for ${email}: ${result.error}`);
                        // Store failed result with error
                        failures.push({ 
                            email, 
                            password, 
                            proxy_str, 
                            twofa, 
                            error: result.error || "Unknown error" 
                        });
                    }
                } catch (error) {
                    console.error(`💥 [Worker ${workerId}] Exception processing ${email}: ${error.message}`);
                    console.error(`Stack trace:`, error.stack);
                    // Store exception as a failure
                    failures.push({ 
                        email, 
                        password, 
                        proxy_str, 
                        twofa, 
                        error: error.message 
                    });
                } finally {
                    activeWorkers--;
                    completed++;
                    console.log(`🏁 [Worker ${workerId}] Completed task (Active: ${activeWorkers}/${maxConcurrent}, Completed: ${completed}/${total})\n`);
                }

                // Add a small random delay to prevent race conditions
                await delay(Math.random() * 500 + 250);
            }
        }

        // Create and start exactly maxConcurrent workers
        const workers = Array.from({ length: maxConcurrent }, (_, index) => worker(index + 1));
        await Promise.all(workers);

        // Write results to files
        console.log("Writing results to output files...");
        if (successes.length > 0) {
            await writeToCSV(successes, successPath);
            console.log(`✅ Successful results saved to ${successPath}`);
        }
        if (failures.length > 0) {
            await writeToCSV(failures, failedPath);
            console.log(`❌ Failed results saved to ${failedPath}`);
        }

        console.log(`\n📊 FINAL RESULTS:`);
        console.log(`Total processed: ${total}`);
        console.log(`Successful: ${successes.length}`);
        console.log(`Failed: ${failures.length}`);
        
        return { successes, failures };
    } catch (error) {
        console.error(`💥 Error in processCredentialsConcurrently: ${error.message}`);
        throw error;
    }
}

/**
 * Main function to run the script
 */
async function main() {
    const inputFilePath = './input.csv';
    const maxConcurrent = 1; // Set to 1 for debugging
    
    try {
        console.log(`🚀 Starting Outlook automation script...`);
        console.log(`Input file: ${inputFilePath}`);
        console.log(`Max concurrent: ${maxConcurrent}`);
        
        await processCredentialsConcurrently(inputFilePath, maxConcurrent);
        console.log("🎉 Script execution completed successfully");
    } catch (error) {
        console.error(`💥 Script execution failed: ${error.message}`);
        process.exit(1);
    }
}

// Run the script
main();
import { mainWithCredentials } from './mainWithCredentials.js';
import { readCsv, writeToCSV, delay } from './helperFunctions.js';
import path from 'path';
import fs from 'fs';

/**
 * High-performance credential processing
 */
async function processCredentialsConcurrently(inputFilePath, maxConcurrent = 3) {
    try {
        console.log(`🚀 Starting high-volume processing: ${inputFilePath}`);
        const credentials = await readCsv(inputFilePath);
        console.log(`📊 Processing ${credentials.length} credentials with ${maxConcurrent} concurrent workers`);

        const outputDir = path.resolve('./results');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const successPath = path.join(outputDir, 'success.csv');
        const failedPath = path.join(outputDir, 'failed.csv');

        // Initialize CSV files with headers
        const successHeader = 'email,password,proxy_str,twofa\n';
        const failedHeader = 'email,password,proxy_str,twofa,error\n';
        
        fs.writeFileSync(successPath, successHeader);
        fs.writeFileSync(failedPath, failedHeader);
        console.log(`📁 Initialized CSV files: ${successPath}, ${failedPath}`);

        const successes = [];
        const failures = [];
        const queue = [...credentials];
        let completed = 0;
        const total = queue.length;
        const startTime = Date.now();

        // Real-time CSV writing function
        function appendToCSV(filePath, data) {
            try {
                const csvLine = Object.values(data).map(value => {
                    // Escape quotes and wrap in quotes if contains comma or quote
                    const stringValue = String(value || '');
                    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                        return `"${stringValue.replace(/"/g, '""')}"`;
                    }
                    return stringValue;
                }).join(',') + '\n';
                
                fs.appendFileSync(filePath, csvLine);
                return true;
            } catch (err) {
                console.error(`❌ Failed to write to ${filePath}: ${err.message}`);
                return false;
            }
        }

        // Progress reporting
        const progressInterval = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = completed / elapsed;
            const remaining = total - completed;
            const eta = remaining / rate;
            
            console.log(`📈 Progress: ${completed}/${total} (${(completed/total*100).toFixed(1)}%) | Rate: ${rate.toFixed(1)}/s | ETA: ${Math.round(eta/60)}m`);
        }, 30000); // Report every 30 seconds

        async function worker(workerId) {
            while (queue.length > 0) {
                const credential = queue.shift();
                if (!credential) break;
                
                const { email, password, proxy_str, twofa } = credential;

                // Add random delay between attempts to avoid detection
                if (completed > 0) {
                    const delayMs = Math.random() * 5000 + 2000; // 2-7 seconds
                    console.log(`⏳ [${workerId}] Waiting ${Math.round(delayMs/1000)}s before next attempt...`);
                    await delay(delayMs);
                }

                try {
                    const result = await mainWithCredentials(email, password, proxy_str, twofa);

                    if (result && result.success) {
                        const successRecord = { email, password, proxy_str, twofa };
                        successes.push(successRecord);
                        
                        // Write to CSV immediately
                        const csvWritten = appendToCSV(successPath, successRecord);
                        console.log(`✅ [${workerId}] ${email} - SUCCESS ${csvWritten ? '(CSV ✓)' : '(CSV ✗)'}`);
                    } else {
                        const errorMsg = result?.error || "Unknown error - no result returned";
                        const failureRecord = { 
                            email, 
                            password, 
                            proxy_str, 
                            twofa, 
                            error: errorMsg 
                        };
                        failures.push(failureRecord);
                        
                        // Write to CSV immediately
                        const csvWritten = appendToCSV(failedPath, failureRecord);
                        console.log(`❌ [${workerId}] ${email} - FAILED: ${errorMsg} ${csvWritten ? '(CSV ✓)' : '(CSV ✗)'}`);
                    }
                } catch (error) {
                    const failureRecord = { 
                        email, 
                        password, 
                        proxy_str, 
                        twofa, 
                        error: `Exception: ${error.message}` 
                    };
                    failures.push(failureRecord);
                    
                    // Write to CSV immediately
                    const csvWritten = appendToCSV(failedPath, failureRecord);
                    console.log(`💥 [${workerId}] ${email} - EXCEPTION: ${error.message} ${csvWritten ? '(CSV ✓)' : '(CSV ✗)'}`);
                } finally {
                    completed++;
                }
                
                // Brief pause to prevent overwhelming
                await delay(100);
            }
        }

        // Start workers
        const workers = Array.from({ length: maxConcurrent }, (_, index) => worker(index + 1));
        await Promise.all(workers);
        
        clearInterval(progressInterval);
        
        const totalTime = (Date.now() - startTime) / 1000;
        const avgRate = completed / totalTime;

        // Write results with guaranteed execution (final backup)
        console.log(`\n💾 Creating final backup files...`);
        
        try {
            if (successes.length > 0) {
                await writeToCSV(successes, path.join(outputDir, 'final_success_backup.csv'));
                console.log(`✅ Final backup: ${successes.length} successful results`);
            }
        } catch (writeError) {
            console.error(`❌ Error writing final success backup: ${writeError.message}`);
        }
        
        try {
            if (failures.length > 0) {
                await writeToCSV(failures, path.join(outputDir, 'final_failed_backup.csv'));
                console.log(`✅ Final backup: ${failures.length} failed results`);
            }
        } catch (writeError) {
            console.error(`❌ Error writing final failed backup: ${writeError.message}`);
        }

        console.log(`\n🎉 COMPLETED IN ${Math.round(totalTime/60)}m ${Math.round(totalTime%60)}s`);
        console.log(`📊 RESULTS: ${successes.length} success, ${failures.length} failed`);
        console.log(`⚡ AVERAGE RATE: ${avgRate.toFixed(2)} logins/second`);
        console.log(`✅ Success rate: ${(successes.length/total*100).toFixed(1)}%`);
        console.log(`📁 Real-time files: ${successPath} (${successes.length} records), ${failedPath} (${failures.length} records)`);
        
        return { successes, failures, totalTime, avgRate };
    } catch (error) {
        console.error(`💥 Critical error: ${error.message}`);
        
        // Emergency write - save whatever we have
        console.log(`🚨 Attempting emergency save of partial results...`);
        try {
            if (successes && successes.length > 0) {
                await writeToCSV(successes, path.join(outputDir, 'emergency_success.csv'));
                console.log(`💾 Saved ${successes.length} successes to emergency file`);
            }
            if (failures && failures.length > 0) {
                await writeToCSV(failures, path.join(outputDir, 'emergency_failed.csv'));
                console.log(`💾 Saved ${failures.length} failures to emergency file`);
            }
        } catch (emergencyError) {
            console.error(`❌ Emergency save failed: ${emergencyError.message}`);
        }
        
        throw error;
    }
}

async function main() {
    const inputFilePath = './input.csv';
    const maxConcurrent = 3; // Reduced for anti-detection
    
    try {
        console.log(`🚀 HIGH-VOLUME OUTLOOK AUTOMATION (STEALTH MODE)`);
        console.log(`📁 Input: ${inputFilePath}`);
        console.log(`🔧 Concurrency: ${maxConcurrent} (reduced for stealth)`);
        console.log(`⏰ Started: ${new Date().toLocaleString()}\n`);
        
        const results = await processCredentialsConcurrently(inputFilePath, maxConcurrent);
        
        console.log(`\n🏁 FINAL SUMMARY:`);
        console.log(`   Total processed: ${results.successes.length + results.failures.length}`);
        console.log(`   Successful: ${results.successes.length}`);
        console.log(`   Failed: ${results.failures.length}`);
        console.log(`   Success rate: ${(results.successes.length/(results.successes.length + results.failures.length)*100).toFixed(1)}%`);
        console.log(`   Total time: ${Math.round(results.totalTime/60)} minutes`);
        console.log(`   Average rate: ${results.avgRate.toFixed(2)} logins/second`);
        console.log(`   Finished: ${new Date().toLocaleString()}`);
        
    } catch (error) {
        console.error(`💥 Script failed: ${error.message}`);
        process.exit(1);
    }
}

main();
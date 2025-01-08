import { mainWithCredentials } from './mainWithCredentials.js';
import { readCsv, writeToCsv } from './helperFunctions.js';


async function processCredentials(inputFilePath) {
    try {
        console.log(`Reading input file: ${inputFilePath}`);
        const credentials = await readCsv(inputFilePath);

        const successes = [];
        const failures = [];

        console.log(`Processing ${credentials.length} credentials...`);
        for (const { email, password, proxy_str, twofa } of credentials) {
            console.log(`Starting task for ${email} with proxy ${proxy_str}...`);
            const result = await mainWithCredentials(email, password, proxy_str, twofa);

            if (result.success) {
                console.log(`Successfully logged in: ${email}`);
                successes.push({ email, password, proxy_str, twofa });
            } else {
                console.error(`Failed to process: ${email}`);
                failures.push({ email, password, proxy_str, twofa, error: result.error || "Unknown error" });
            }
        }

        console.log("Writing results to output files...");
        if (successes.length > 0) {
            await writeToCSV(successes, 'success.csv');
            console.log("Successful results saved to success.csv");
        }
        if (failures.length > 0) {
            await writeToCSV(failures, 'failed.csv');
            console.log("Failed results saved to failed.csv");
        }

        console.log("Processing completed.");
    } catch (error) {
        console.error(`Error in processCredentials: ${error.message}`);
    }
}

// Run the script with the provided input file
const inputFilePath = './input.csv';
processCredentials(inputFilePath);

## Outlook Script

JS script to automate logging into Outlook accounts using 2fa.live codes and validating Ticketmaster emails do not get sent to Junk. 

### Setup Instructions
- Change the path for both the input and logs. Indicated by ******* in the outlookScript.js
- Input the input.csv file with the information needed: email, password, proxy and 2fa code
- Make sure you are using username:pass authentication proxies. 
- Any error logging will be output to the logs.txt file to debug. 

Input: /Your/Path/to/input.csv

Log: /Your/Path/to/logs.xtx


### Requirements
- Node.js
https://nodejs.org/en/download

### Installation
- Clone this repository or download the ZIP file.
- Navigate to the project directory and run:
npm install
- To start the application, run:
npm start
- Script will run and output a new CSV with accounts that errored out to check or rerun in same folder as script is in.

Feel free to raise any issues.


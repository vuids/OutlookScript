#Outlook Script

JS script to automate logging into Outlook accounts using 2fa.live codes and validating Ticketmaster emails do not get sent to Junk. 

### Setup Instructions
1.) Change the path for both the input and logs. Indicated by ******* in the outlookScript.js
2.) Input the input.csv file with the information needed: email, password, proxy and 2fa code
3.) Make sure you are using username:pass authentication proxies. 
4.) Any error logging will be output to the logs.txt file to debug. 

Input: /Your/Path/to/input.csv

Log: /Your/Path/to/logs.xtx


### Requirements
- Node.js
https://nodejs.org/en/download

### Installation
1.) Clone this repository or download the ZIP file.
2.) Navigate to the project directory and run:
npm install
3.) To start the application, run:
npm start
4.)Script will run and output a new CSV with accounts that errored out to check or rerun in same folder as script is in.

Feel free to raise any issues.


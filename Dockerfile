# Use official Node.js base image with Puppeteer dependencies pre-installed
FROM ghcr.io/puppeteer/puppeteer:latest

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm install

# Copy your entire project (adjust if you use .dockerignore)
COPY . .

# Ensure Puppeteer uses the correct executable path
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

# Run the script
CMD ["node", "outlookScript.js"]
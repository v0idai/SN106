FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./
COPY tsconfig.json ./


# Install dependencies
RUN npm install

# Copy application code
COPY validator ./validator
COPY utils ./utils
COPY config ./config

# Create logs and data directories
RUN mkdir -p logs data

# Expose port
EXPOSE 3000

# Start the validator
CMD ["npm", "run", "validator"] 
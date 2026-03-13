# Use an official Node.js runtime as a parent image.
# Using a specific version like 20-alpine is good for reproducibility and security.
FROM node:20-alpine

# Set the working directory in the container.
WORKDIR /app

# Copy package.json and lock file to leverage Docker's layer caching.
# This step will only be re-run when these files change, speeding up subsequent builds.
COPY package*.json ./

# Install dependencies.
# If you use yarn, change this to 'RUN yarn install --frozen-lockfile'.
# If you use pnpm, change this to 'RUN pnpm install --frozen-lockfile'.
RUN npm install

# Copy the rest of the application code into the container.
# For local development, this will likely be overwritten by a volume mount in docker-compose.yml,
# but it's good practice for building a standalone development image.
COPY . .

# The Next.js development server runs on port 3000 by default.
EXPOSE 3000

# The command to start the Next.js development server.
# `next dev` automatically listens on 0.0.0.0 when in a container.
CMD ["npm", "run", "dev"]
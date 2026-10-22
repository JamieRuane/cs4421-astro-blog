
# Stage 1: Build the Astro application
FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build the SSR application
COPY . .
RUN npm run build


# Stage 2: Run the standalone SSR server
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

WORKDIR /app

# Copy the generated SSR application and its dependencies
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# Expose the application port
EXPOSE 8080

# Run as a non-root user
USER node

# Check whether the application is healthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8080/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start Astro's standalone Node.js server
CMD ["node", "dist/server/entry.mjs"]
